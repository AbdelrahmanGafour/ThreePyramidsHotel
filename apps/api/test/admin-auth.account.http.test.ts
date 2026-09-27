import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

// Two things this proves without PostgreSQL, and only those.
//
//  1. The route table: that both account routes exist, at the agreed methods
//     and paths, each running `requireAdminSession` first in its chain.
//  2. That authentication is settled before anything else is judged — a
//     malformed body, an unusable email and a policy-breaking password all
//     answer 401 without a session, so an anonymous caller learns nothing
//     about what a valid body looks like.
//
// It deliberately does not reach a handler. Every status and body that needs a
// session and a real account — 200, 204, the 400s, the 401 for a wrong current
// password, and both 409s — is proven against real PostgreSQL in
// admin-auth.account.integration.test.ts, and the service's own decisions in
// admin-auth.account.test.ts. Building a second, mock-backed HTTP harness to
// assert them here would test a stand-in, not the API.

let server: Server;
let baseUrl: string;

/** The exact admin auth surface. A new row here must be a deliberate edit. */
const EXPECTED_AUTH_ROUTES = [
  'POST   /api/v1/admin/auth/login',
  'POST   /api/v1/admin/auth/logout',
  'GET    /api/v1/admin/auth/session',
  'PATCH  /api/v1/admin/auth/account/email',
  'PATCH  /api/v1/admin/auth/account/password',
];

const NOT_AUTHENTICATED = {
  error: { code: 'NOT_AUTHENTICATED', message: 'Authentication required' },
};

const INVALID_JSON = {
  error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
};

type JsonResponse = { status: number; json: unknown };

async function send(method: string, path: string, body?: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body,
  });

  return { status: response.status, json: await response.json().catch(() => undefined) };
}

/** Describes one router's routes in the form the expectations above use. */
function describeRoutes(router: { stack: unknown[] }, mount: string): string[] {
  const rows: string[] = [];

  for (const layer of router.stack as {
    route?: { path: string; methods: Record<string, boolean> };
  }[]) {
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
function chainFor(router: { stack: unknown[] }, method: string, path: string): string[] {
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
  // import time. No connection is ever opened by these tests: every request
  // below is refused by the session guard before a handler runs.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('the admin auth route table', () => {
  it('registers exactly the auth routes, in the declared order', async () => {
    const { adminAuthRouter } = await import('../src/modules/admin-auth/admin-auth.routes.js');

    assert.deepEqual(
      describeRoutes(adminAuthRouter as never, '/api/v1/admin/auth'),
      EXPECTED_AUTH_ROUTES,
    );
  });

  it('guards both account routes with requireAdminSession, first in the chain', async () => {
    const { adminAuthRouter } = await import('../src/modules/admin-auth/admin-auth.routes.js');

    for (const path of ['/account/email', '/account/password']) {
      const chain = chainFor(adminAuthRouter as never, 'PATCH', path);

      assert.equal(chain[0], 'requireAdminSession', `${path} must be guarded first`);
      assert.equal(chain.length, 2, `${path} should be guard + handler and nothing else`);
    }
  });

  it('routes each account path to its own handler', async () => {
    const { adminAuthRouter } = await import('../src/modules/admin-auth/admin-auth.routes.js');

    const handler = (path: string) => chainFor(adminAuthRouter as never, 'PATCH', path)[1];

    assert.equal(handler('/account/email'), 'adminChangeEmailHandler');
    assert.equal(handler('/account/password'), 'adminChangePasswordHandler');
  });

  it('adds no route that names a target account', async () => {
    const { adminAuthRouter } = await import('../src/modules/admin-auth/admin-auth.routes.js');
    const all = describeRoutes(adminAuthRouter as never, '/api/v1/admin/auth').join('\n');

    // Self-service only: there is no id or email in any path, so no route
    // shape exists in which one administrator addresses another's account.
    assert.doesNotMatch(all, /:id|:adminUserId|:email|:slug/);
    assert.doesNotMatch(all, /DELETE/);
    // And no second way to say the same thing.
    assert.doesNotMatch(all, /reset|forgot|recover/i);
  });

  it('leaves login, logout and session exactly as they were', async () => {
    const { adminAuthRouter } = await import('../src/modules/admin-auth/admin-auth.routes.js');

    assert.deepEqual(chainFor(adminAuthRouter as never, 'POST', '/login'), ['adminLoginHandler']);
    assert.deepEqual(chainFor(adminAuthRouter as never, 'POST', '/logout'), ['adminLogoutHandler']);
    assert.deepEqual(chainFor(adminAuthRouter as never, 'GET', '/session'), [
      'requireAdminSession',
      'adminSessionHandler',
    ]);
  });
});

describe('authentication precedence on the account routes', () => {
  // Every case carries something else that is also wrong — a malformed body,
  // an unusable address, a password that breaks the policy, an extra key. The
  // answer is 401 regardless.
  const cases: [string, string][] = [
    ['/account/email', JSON.stringify({ currentPassword: 'current 1', email: 'a@b.com' })],
    ['/account/email', JSON.stringify({ currentPassword: 'current 1', email: 'not-an-email' })],
    ['/account/email', JSON.stringify({})],
    ['/account/email', JSON.stringify({ email: 'a@b.com', currentPassword: 'x', extra: true })],
    ['/account/password', JSON.stringify({ currentPassword: 'current 1', newPassword: 'newer 22' })],
    ['/account/password', JSON.stringify({ currentPassword: 'current 1', newPassword: 'weak' })],
    ['/account/password', JSON.stringify({})],
  ];

  for (const [path, body] of cases) {
    it(`PATCH ${path} answers 401 before the body is judged`, async () => {
      const response = await send('PATCH', `/api/v1/admin/auth${path}`, body);

      assert.equal(response.status, 401);
      assert.deepEqual(response.json, NOT_AUTHENTICATED);
    });
  }

  it('answers identically whether the body is valid or nonsense', async () => {
    const valid = await send(
      'PATCH',
      '/api/v1/admin/auth/account/email',
      JSON.stringify({ currentPassword: 'current 1', email: 'a@b.com' }),
    );
    const nonsense = await send('PATCH', '/api/v1/admin/auth/account/email', JSON.stringify({}));

    assert.deepEqual(valid, nonsense, 'an anonymous caller learns nothing about the contract');
  });

  it('never echoes a submitted password in the refusal', async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/auth/account/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'hunter 42', newPassword: 'secret 99' }),
    });

    const text = await response.text();

    assert.equal(response.status, 401);
    assert.ok(!text.includes('hunter 42'));
    assert.ok(!text.includes('secret 99'));
  });

  it('refuses a session cookie that is not a canonical token', async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/auth/account/email`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: 'tph_admin_session=not-a-token' },
      body: JSON.stringify({ currentPassword: 'current 1', email: 'a@b.com' }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), NOT_AUTHENTICATED);
  });
});

describe('the global JSON parser still runs before the account routes', () => {
  // Established application behaviour: express.json() is mounted globally and
  // rejects a body it cannot parse before any router is reached, so
  // INVALID_JSON can precede a 401.
  for (const path of ['/account/email', '/account/password']) {
    it(`PATCH ${path} answers INVALID_JSON for a malformed body`, async () => {
      const response = await send('PATCH', `/api/v1/admin/auth${path}`, '{"currentPassword": ');

      assert.equal(response.status, 400);
      assert.deepEqual(response.json, INVALID_JSON);
    });
  }
});

describe('the methods the account paths do not answer', () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    it(`${method} /account/email is not routed`, async () => {
      const response = await send(method, '/api/v1/admin/auth/account/email');

      assert.notEqual(response.status, 200);
      assert.notEqual(response.status, 204);
    });
  }
});
