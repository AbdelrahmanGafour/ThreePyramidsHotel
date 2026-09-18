import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

// Starts the real Express app on an ephemeral port and talks to it over HTTP.
// Nothing here reaches PostgreSQL: a malformed body is rejected by the JSON
// parser before any route handler runs.
let server: Server;
let baseUrl: string;

before(async () => {
  // The app's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. No connection is ever opened by these tests.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';

  const { createApp } = await import('../src/app.js');
  const app = createApp();

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function postRawBody(path: string, body: string): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return { status: response.status, json: await response.json() };
}

const invalidJsonResponse = {
  error: {
    code: 'INVALID_JSON',
    message: 'Request body contains invalid JSON',
  },
};

describe('malformed JSON handling', () => {
  it('answers a truncated JSON body with 400 INVALID_JSON', async () => {
    const response = await postRawBody('/api/v1/reservations', '{"roomTypeSlug":');

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, invalidJsonResponse);
  });

  it('answers a body that is not JSON at all with 400 INVALID_JSON', async () => {
    const response = await postRawBody('/api/v1/reservations', 'not json at all');

    assert.equal(response.status, 400);
    assert.deepEqual(response.json, invalidJsonResponse);
  });

  it('leaves unrelated routes working', async () => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});
