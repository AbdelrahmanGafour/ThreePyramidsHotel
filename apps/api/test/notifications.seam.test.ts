import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import {
  buildRoomReservationCreatedEvent,
  buildRoomReservationConfirmedEvent,
} from '../src/modules/notifications/notifications.events';
import type { ClaimedNotificationEvent } from '../src/modules/notifications/notifications.repository';
import type { DispatcherSettings } from '../src/modules/notifications/notifications.dispatcher';

// The seam, end to end, with nothing between the pieces but the pieces.
//
// Every other notification suite injects around the thing next to it: the
// dispatcher tests stub BOTH the renderer and the adapter, the template tests
// never reach a provider, and the adapter tests never see a real payload. Each
// is right on its own, and together they leave one gap — nothing proves that
// what the real renderer produces is something the real adapter will accept and
// send, from a payload shaped exactly as the outbox stores it.
//
// This file closes that gap and nothing else. It is deliberately small: the
// template catalogue and the provider's error mapping are exhaustively covered
// where they belong, and repeating them here would just mean two places to
// update.
//
// Composition:
//
//   real dispatchNotificationBatch
//     -> real renderNotificationEmail   (the dispatcher's own default)
//     -> real sendNotificationEmail     (bound to a fake fetch)
//
// Only the database edges are stubbed — the claim and the state writes — plus
// `fetch`. No network, no pool, no environment.

type DispatcherModule = typeof import('../src/modules/notifications/notifications.dispatcher.js');
type ResendModule = typeof import('../src/modules/notifications/notifications.resend.js');
type TemplatesModule = typeof import('../src/modules/notifications/notifications.templates.js');

let dispatchNotificationBatch: DispatcherModule['dispatchNotificationBatch'];
let sendNotificationEmail: ResendModule['sendNotificationEmail'];
let renderNotificationEmail: TemplatesModule['renderNotificationEmail'];

before(async () => {
  // The dispatcher reaches `db/pool` for its default client factory, which
  // reads the environment at module load. Nothing here connects.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dispatchNotificationBatch } = await import(
    '../src/modules/notifications/notifications.dispatcher.js'
  ));
  ({ sendNotificationEmail } = await import('../src/modules/notifications/notifications.resend.js'));
  ({ renderNotificationEmail } = await import(
    '../src/modules/notifications/notifications.templates.js'
  ));
});

/** Obviously fake, and short enough to spot in a diff if it ever escaped. */
const API_KEY = 're_fake_seam_key_not_a_credential';

const SETTINGS: DispatcherSettings = {
  apiKey: API_KEY,
  // Never used by a claimed row: the envelope below is already frozen.
  fromAddress: 'unused-config-sender@example.test',
  hotelRecipient: 'unused-config-recipient@example.test',
  requestTimeoutMs: 5000,
  batchSize: 1,
  maxAttempts: 5,
  claimLeaseSeconds: 5,
  retryDelaySecondsFor: () => 60,
};

/**
 * A claimed row carrying the payload the business flow really stores.
 *
 * Built by the real event builder and round-tripped through JSON, because that
 * is what `jsonb` does to it between the reservation transaction and the claim.
 * A hand-written object literal would quietly skip both.
 */
function claimedFrom(
  event: { eventType: string; bookingReference: string; templateKey: string; payload: unknown },
  overrides: Partial<ClaimedNotificationEvent> = {},
): ClaimedNotificationEvent {
  return {
    id: '4242',
    eventType: event.eventType,
    bookingReference: event.bookingReference,
    recipientKind: 'hotel',
    recipientEmail: null,
    templateKey: event.templateKey,
    payload: JSON.parse(JSON.stringify(event.payload)),
    attempts: 1,
    resolvedFrom: 'Three Pyramids <stay@frozen.example.test>',
    resolvedTo: 'desk@frozen.example.test',
    ...overrides,
  };
}

const ROOM_CREATED = buildRoomReservationCreatedEvent({
  bookingReference: 'TPH-A2B3C4D5E6F7',
  guestFirstName: 'Amina',
  guestLastName: 'Khalil',
  guestEmail: 'amina@example.test',
  guestPhone: '+20 100 000 0000',
  guestCountry: 'EG',
  roomTypeName: 'Nile View Suite',
  checkIn: '2026-04-10',
  checkOut: '2026-04-13',
  nights: 3,
  adults: 2,
  children: 1,
  nightlyRate: '4200.00',
  totalAmount: '12600.00',
  specialRequests: 'Late arrival, around 23:00.',
});

const ROOM_CONFIRMED = buildRoomReservationConfirmedEvent({
  bookingReference: 'TPH-J8K9L2M3N4P5',
  guestFirstName: 'Tomas',
  guestLastName: 'Novak',
  guestEmail: 'tomas@example.test',
  roomTypeName: 'Garden Room',
  checkIn: '2026-05-02',
  checkOut: '2026-05-04',
  nights: 2,
  adults: 2,
  children: 0,
  nightlyRate: '1800.00',
  totalAmount: '3600.00',
  specialRequests: null,
});

type Recorded = { url: string; init: RequestInit };
type Write = { kind: string; input: Record<string, unknown> };

/**
 * Runs one real pass over one claimed row.
 *
 * `render` is NOT passed, so the dispatcher uses the real renderer. `send` is
 * the real adapter with a fake fetch bound to it — the adapter's own signature
 * takes its fetch as a second argument, so this needs no monkey-patching and
 * no global is touched.
 *
 * `globalThis.fetch` is replaced for the duration with something that throws,
 * so "no network" is proved rather than assumed: if any code path reached the
 * real fetch, this test would fail rather than quietly making a request.
 */
async function runPass(
  row: ClaimedNotificationEvent,
  response: { status: number; body: unknown },
): Promise<{ calls: Recorded[]; writes: Write[]; globalFetchCalls: number }> {
  const calls: Recorded[] = [];
  const writes: Write[] = [];
  let globalFetchCalls = 0;

  const realGlobalFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    globalFetchCalls += 1;
    throw new Error('the seam test must never reach the real fetch');
  }) as typeof globalThis.fetch;

  try {
    const summary = await dispatchNotificationBatch(SETTINGS, {
      acquireClient: async () =>
        ({
          query: async () => ({ rows: [], rowCount: 0 }),
          release: () => undefined,
        }) as unknown as PoolClient,
      claim: async () => [row],
      // render is deliberately absent: the real one is used.
      send: (input) =>
        sendNotificationEmail(input, async (url, init) => {
          calls.push({ url, init });

          return {
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
            async json() {
              return response.body;
            },
          } as unknown as Response;
        }),
      markAccepted: async (_client, input) => {
        writes.push({ kind: 'accepted', input: input as unknown as Record<string, unknown> });
        return { applied: true };
      },
      markAttemptFailed: async (_client, input) => {
        writes.push({ kind: 'attemptFailed', input: input as unknown as Record<string, unknown> });
        return { applied: true };
      },
      markAbandoned: async (_client, input) => {
        writes.push({ kind: 'abandoned', input: input as unknown as Record<string, unknown> });
        return { applied: true };
      },
    });

    assert.equal(summary.claimed, 1, 'the pass saw exactly the one claimed row');

    return { calls, writes, globalFetchCalls };
  } finally {
    globalThis.fetch = realGlobalFetch;
  }
}

const bodyOf = (call: Recorded): Record<string, string> =>
  JSON.parse(String(call.init.body)) as Record<string, string>;

const headersOf = (call: Recorded): Record<string, string> =>
  (call.init.headers ?? {}) as Record<string, string>;

describe('a stored room-created event reaches the provider intact', () => {
  const row = claimedFrom(ROOM_CREATED);
  const accepted = { status: 200, body: { id: 'msg_seam_1' } };

  it('makes exactly one provider request, and never the real fetch', async () => {
    const { calls, globalFetchCalls } = await runPass(row, accepted);

    assert.equal(calls.length, 1, 'one row, one request');
    assert.equal(globalFetchCalls, 0, 'the injected fetch was the only one used');
  });

  it('builds the request the Resend adapter is contracted to build', async () => {
    const { calls } = await runPass(row, accepted);
    const call = calls[0] as Recorded;

    assert.equal(call.url, 'https://api.resend.com/emails');
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(headersOf(call), {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'room_reservation_created:TPH-A2B3C4D5E6F7',
    });
    assert.deepEqual(Object.keys(bodyOf(call)), ['from', 'to', 'subject', 'html', 'text']);
  });

  it('sends the frozen envelope, never the configured addresses', async () => {
    const { calls } = await runPass(row, accepted);
    const body = bodyOf(calls[0] as Recorded);

    assert.equal(body.from, 'Three Pyramids <stay@frozen.example.test>');
    assert.equal(body.to, 'desk@frozen.example.test');
    assert.equal(body.from.includes('unused-config'), false, 'settings only seed a first claim');
    assert.equal(body.to.includes('unused-config'), false);
  });

  it('sends exactly what the real renderer produced, byte for byte', async () => {
    // The assertion this whole file exists for: the renderer's output and the
    // adapter's request are the same three strings, with nothing in between
    // reshaping, re-encoding or truncating them.
    const { calls } = await runPass(row, accepted);
    const body = bodyOf(calls[0] as Recorded);

    const rendered = renderNotificationEmail('room_created_hotel.v1', ROOM_CREATED.payload);

    assert.equal(body.subject, rendered.subject);
    assert.equal(body.html, rendered.html);
    assert.equal(body.text, rendered.text);
  });

  it('carries a real rendered message, not an empty shell', async () => {
    // Guards against the seam "passing" because both sides agreed on nothing:
    // a payload the renderer could not read would render blanks, and the
    // dispatcher would abandon the row before any request was made.
    const { calls } = await runPass(row, accepted);
    const body = bodyOf(calls[0] as Recorded);

    assert.equal(body.subject, 'New room reservation: TPH-A2B3C4D5E6F7');
    assert.match(body.html, /^<!DOCTYPE html>/);
    for (const fact of ['Nile View Suite', '2026-04-10', '3 nights', '12600.00 EGP', 'Amina']) {
      assert.ok(body.html.includes(fact), `html is missing ${fact}`);
      assert.ok(body.text.includes(fact), `text is missing ${fact}`);
    }
    assert.equal(body.text.includes('<'), false, 'the text part is still plain');
  });

  it('records the acceptance against the claimed attempt', async () => {
    const { writes } = await runPass(row, accepted);

    assert.deepEqual(writes, [
      {
        kind: 'accepted',
        input: { id: '4242', expectedAttempt: 1, providerReference: 'msg_seam_1' },
      },
    ]);
  });

  it('carries the attempt the claim returned, not a fixed one', async () => {
    const retried = claimedFrom(ROOM_CREATED, { id: '77', attempts: 4 });

    const { writes } = await runPass(retried, { status: 200, body: { id: 'msg_seam_retry' } });

    assert.deepEqual(writes[0]?.input, {
      id: '77',
      expectedAttempt: 4,
      providerReference: 'msg_seam_retry',
    });
  });
});

describe('a stored guest-confirmation event reaches the provider intact', () => {
  // The other audience, briefly: a guest template addressed to the guest's own
  // snapshotted address rather than the hotel desk.
  const row = claimedFrom(ROOM_CONFIRMED, {
    id: '99',
    recipientKind: 'guest',
    recipientEmail: 'tomas@example.test',
    resolvedTo: 'tomas@example.test',
  });

  it('renders the guest template and sends it to the frozen guest address', async () => {
    const { calls, writes } = await runPass(row, { status: 200, body: { id: 'msg_seam_guest' } });

    const call = calls[0] as Recorded;
    const body = bodyOf(call);

    assert.equal(headersOf(call)['Idempotency-Key'], 'room_reservation_confirmed:TPH-J8K9L2M3N4P5');
    assert.equal(body.to, 'tomas@example.test');
    assert.equal(body.subject, 'Your reservation is confirmed: TPH-J8K9L2M3N4P5');

    const rendered = renderNotificationEmail('room_confirmed_guest.v1', ROOM_CONFIRMED.payload);
    assert.equal(body.html, rendered.html);
    assert.equal(body.text, rendered.text);

    // A guest confirmation carries no contact block and echoes no address.
    assert.equal(body.html.includes('tomas@example.test'), false, 'the address is the envelope');

    assert.equal(writes[0]?.kind, 'accepted');
    assert.equal(writes[0]?.input.providerReference, 'msg_seam_guest');
  });
});

describe('the seam touches nothing it should not', () => {
  it('reads no environment beyond the placeholder the pool needs', async () => {
    const { readFileSync } = await import('node:fs');

    // Neither of the two modules composed here reads configuration: the
    // dispatcher is handed settings, and the adapter is handed a key.
    for (const file of [
      'src/modules/notifications/notifications.dispatcher.ts',
      'src/modules/notifications/notifications.resend.ts',
      'src/modules/notifications/notifications.templates.ts',
    ]) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

      assert.equal(code.includes('process.env'), false, `${file} must not read the environment`);
    }
  });

  it('never leaks the key into what it records', async () => {
    const { writes } = await runPass(claimedFrom(ROOM_CREATED), {
      status: 200,
      body: { id: 'msg_seam_2' },
    });

    assert.equal(JSON.stringify(writes).includes(API_KEY), false);
  });
});
