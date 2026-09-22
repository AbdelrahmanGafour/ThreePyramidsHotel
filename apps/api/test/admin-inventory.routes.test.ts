import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

// Two things this can prove without PostgreSQL, and it proves only those.
//
//  1. The route table: which methods and paths exist, and that every admin
//     route runs `requireAdminSession` first.
//  2. The two precedence rules at the front of the request, both of which are
//     settled before any handler or any database call:
//       - express.json() is global and runs before route middleware, so
//         malformed JSON answers INVALID_JSON even without a session;
//       - requireAdminSession answers 401 with no cookie, before the slug,
//         the room number, the body or existence is considered.
//
// It deliberately does not reach a handler. Every status/body mapping that
// needs a session and a room type — 200/201 envelopes, 404s, 409s and the 400
// validation contracts — is proven in T02-G against real PostgreSQL. Building
// a second, mock-backed HTTP harness to assert them here would test a
// stand-in, not the API.

type Server_ = Server;

let server: Server_;
let baseUrl: string;

/** The exact admin inventory surface. A new row here must be a deliberate edit. */
const EXPECTED_ADMIN_ROUTES = [
  'GET    /api/v1/admin/room-types/',
  'POST   /api/v1/admin/room-types/',
  'GET    /api/v1/admin/room-types/:slug/rooms',
  'POST   /api/v1/admin/room-types/:slug/rooms',
  'PATCH  /api/v1/admin/room-types/:slug/capacity',
  'GET    /api/v1/admin/room-types/:slug',
  'PATCH  /api/v1/admin/room-types/:slug',
];

const NOT_AUTHENTICATED = {
  error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
};

const INVALID_JSON = {
  error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
};

type JsonResponse = { status: number; json: unknown };

async function send(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body,
  });

  return { status: response.status, json: await response.json().catch(() => undefined) };
}

/** Describes one router's routes in the form the expectations above use. */
function describeRoutes(router: { stack: unknown[] }, mount: string): string[] {
  const rows: string[] = [];

  for (const layer of router.stack as { route?: { path: string; methods: Record<string, boolean> } }[]) {
    if (!layer.route) {
      continue;
    }

    const methods = Object.keys(layer.route.methods)
      .filter((method) => layer.route!.methods[method])
      .map((method) => method.toUpperCase())
      .join(',');

    rows.push(`${methods.padEnd(6)} ${mount}${layer.route.path}`);
  }

  return rows;
}

/** The names of the handlers in one route's chain, in order. */
function chainFor(
  router: { stack: unknown[] },
  method: string,
  path: string,
): string[] {
  const layers = router.stack as {
    route?: { path: string; methods: Record<string, boolean>; stack: { name: string }[] };
  }[];

  const match = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods[method.toLowerCase()],
  );

  assert.ok(match?.route, `expected a ${method} ${path} route`);

  return match.route.stack.map((entry) => entry.name);
}

before(async () => {
  // The app's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. No connection is ever opened by these tests.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  server = await new Promise<Server_>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('the admin inventory route table', () => {
  it('registers exactly the room-type routes, in the declared order', async () => {
    const { adminRoomTypesRouter } = await import(
      '../src/modules/admin-room-types/admin-room-types.routes.js'
    );

    assert.deepEqual(
      describeRoutes(adminRoomTypesRouter as never, '/api/v1/admin/room-types'),
      EXPECTED_ADMIN_ROUTES,
    );
  });

  it('registers exactly one physical-room route, in the admin namespace', async () => {
    const { adminRoomsRouter } = await import('../src/modules/admin-rooms/admin-rooms.routes.js');

    assert.deepEqual(describeRoutes(adminRoomsRouter as never, '/api/v1/admin/rooms'), [
      'PATCH  /api/v1/admin/rooms/:roomNumber',
    ]);
  });

  it('adds no DELETE, status, archive, move or slug-edit route', async () => {
    const { adminRoomTypesRouter } = await import(
      '../src/modules/admin-room-types/admin-room-types.routes.js'
    );
    const { adminRoomsRouter } = await import('../src/modules/admin-rooms/admin-rooms.routes.js');

    const all = [
      ...describeRoutes(adminRoomTypesRouter as never, '/api/v1/admin/room-types'),
      ...describeRoutes(adminRoomsRouter as never, '/api/v1/admin/rooms'),
    ].join('\n');

    assert.doesNotMatch(all, /DELETE/);
    assert.doesNotMatch(all, /\/status\b/);
    assert.doesNotMatch(all, /archive|reactivate|activate/i);
    assert.doesNotMatch(all, /\/move\b|reassign/i);
    assert.doesNotMatch(all, /\/slug\b/);
  });

  it('leaves the public routers untouched', async () => {
    const { roomsRouter } = await import('../src/modules/rooms/rooms.routes.js');
    const { availabilityRouter } = await import('../src/modules/availability/availability.routes.js');
    const { reservationsRouter } = await import('../src/modules/reservations/reservations.routes.js');

    assert.deepEqual(describeRoutes(roomsRouter as never, '/api/v1/rooms'), [
      'GET    /api/v1/rooms/',
      'GET    /api/v1/rooms/:slug',
    ]);
    assert.deepEqual(describeRoutes(availabilityRouter as never, '/api/v1/availability'), [
      'GET    /api/v1/availability/',
    ]);
    assert.deepEqual(describeRoutes(reservationsRouter as never, '/api/v1/reservations'), [
      'POST   /api/v1/reservations/',
    ]);
  });

  it('guards every admin route with requireAdminSession, first in the chain', async () => {
    const { adminRoomTypesRouter } = await import(
      '../src/modules/admin-room-types/admin-room-types.routes.js'
    );
    const { adminRoomsRouter } = await import('../src/modules/admin-rooms/admin-rooms.routes.js');

    const chains: [string, string[]][] = [
      ['GET /', chainFor(adminRoomTypesRouter as never, 'GET', '/')],
      ['POST /', chainFor(adminRoomTypesRouter as never, 'POST', '/')],
      ['GET /:slug/rooms', chainFor(adminRoomTypesRouter as never, 'GET', '/:slug/rooms')],
      ['POST /:slug/rooms', chainFor(adminRoomTypesRouter as never, 'POST', '/:slug/rooms')],
      ['PATCH /:slug/capacity', chainFor(adminRoomTypesRouter as never, 'PATCH', '/:slug/capacity')],
      ['GET /:slug', chainFor(adminRoomTypesRouter as never, 'GET', '/:slug')],
      ['PATCH /:slug', chainFor(adminRoomTypesRouter as never, 'PATCH', '/:slug')],
      ['PATCH /:roomNumber', chainFor(adminRoomsRouter as never, 'PATCH', '/:roomNumber')],
    ];

    for (const [label, chain] of chains) {
      assert.equal(chain[0], 'requireAdminSession', `${label} must be guarded first`);
      assert.equal(chain.length, 2, `${label} should be guard + handler and nothing else`);
    }
  });

  it('routes each two-segment path to its own handler, not the generic /:slug', async () => {
    const { adminRoomTypesRouter } = await import(
      '../src/modules/admin-room-types/admin-room-types.routes.js'
    );

    const handler = (method: string, path: string) =>
      chainFor(adminRoomTypesRouter as never, method, path)[1];

    assert.equal(handler('PATCH', '/:slug/capacity'), 'updateAdminRoomTypeCapacityHandler');
    assert.equal(handler('GET', '/:slug/rooms'), 'listAdminPhysicalRoomsHandler');
    assert.equal(handler('POST', '/:slug/rooms'), 'createAdminPhysicalRoomHandler');
    // The T01 routes still reach the T01 handlers.
    assert.equal(handler('GET', '/:slug'), 'getAdminRoomTypeHandler');
    assert.equal(handler('PATCH', '/:slug'), 'updateAdminRoomTypeHandler');
    // POST / and GET / are distinct operations on the same path.
    assert.equal(handler('GET', '/'), 'listAdminRoomTypesHandler');
    assert.equal(handler('POST', '/'), 'createAdminRoomTypeHandler');
  });
});

describe('authentication precedence on the new endpoints', () => {
  // Every case below carries something else that is also wrong — a malformed
  // slug, an unusable room number, a body that could never be accepted. The
  // answer is 401 regardless: an anonymous caller learns nothing about which
  // room types exist or what a valid body looks like.
  const cases: [string, string, string | undefined][] = [
    ['POST', '/api/v1/admin/room-types', JSON.stringify({ nonsense: true })],
    ['POST', '/api/v1/admin/room-types', JSON.stringify({})],
    ['PATCH', '/api/v1/admin/room-types/garden-suite/capacity', JSON.stringify({ capacity: 2 })],
    ['PATCH', '/api/v1/admin/room-types/NOT-CANONICAL/capacity', JSON.stringify({ capacity: 0 })],
    ['GET', '/api/v1/admin/room-types/garden-suite/rooms', undefined],
    ['GET', '/api/v1/admin/room-types/NOT-CANONICAL/rooms', undefined],
    ['POST', '/api/v1/admin/room-types/garden-suite/rooms', JSON.stringify({ roomNumber: 'D-101' })],
    ['POST', '/api/v1/admin/room-types/garden-suite/rooms', JSON.stringify({ roomNumber: 'D/101' })],
    ['PATCH', '/api/v1/admin/rooms/D-101', JSON.stringify({ isActive: false })],
    ['PATCH', '/api/v1/admin/rooms/%20D-101%20', JSON.stringify({ isActive: false })],
    ['PATCH', '/api/v1/admin/rooms/D-101', JSON.stringify({ roomNumber: 'D/999' })],
    ['PATCH', '/api/v1/admin/rooms/D-101', JSON.stringify({})],
  ];

  for (const [method, path, body] of cases) {
    it(`${method} ${path} answers 401 before anything else is judged`, async () => {
      const response = await send(method, path, body);

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    });
  }

  it('reveals nothing about validity, existence or conflicts', async () => {
    const valid = await send('GET', '/api/v1/admin/room-types/garden-suite/rooms');
    const malformed = await send('GET', '/api/v1/admin/room-types/NOT-CANONICAL/rooms');
    const missing = await send('GET', '/api/v1/admin/room-types/no-such-room-type-here/rooms');

    assert.deepEqual(valid, malformed);
    assert.deepEqual(valid, missing);
  });
});

describe('the global JSON parser runs before route middleware', () => {
  // Established application behaviour, not something this ticket changed:
  // express.json() is mounted globally and rejects a body it cannot parse
  // before any router is reached — so INVALID_JSON can precede a 401.
  const paths = [
    '/api/v1/admin/room-types',
    '/api/v1/admin/room-types/garden-suite/rooms',
  ];

  for (const path of paths) {
    it(`POST ${path} answers INVALID_JSON for a malformed body`, async () => {
      const response = await send('POST', path, '{"slug": ');

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_JSON);
    });

    it(`POST ${path} answers INVALID_JSON for a top-level primitive`, async () => {
      const response = await send('POST', path, '"a string"');

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_JSON);
    });
  }

  it('PATCH /api/v1/admin/rooms/:roomNumber answers INVALID_JSON for a malformed body', async () => {
    const response = await send('PATCH', '/api/v1/admin/rooms/D-101', '{isActive: false}');

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, INVALID_JSON);
  });

  it('but a well-formed body on the same route reaches the guard, which refuses it', async () => {
    // The distinction the two rules draw: the parser owns the transport, the
    // guard owns the route.
    const response = await send('PATCH', '/api/v1/admin/rooms/D-101', JSON.stringify({ isActive: false }));

    assert.equal(response.status, 401);
    assert.deepEqual(response.json, NOT_AUTHENTICATED);
  });
});
