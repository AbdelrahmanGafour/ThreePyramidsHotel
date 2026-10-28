import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { buildPackageReservationConfirmedEvent } from '../src/modules/notifications/notifications.events';

// The guest confirmation for a journey, written in the status transaction.
//
// MySQL has no data-modifying CTE, so the status change runs as one short
// transaction: lock the row, check the transition, UPDATE, queue the event
// built by the shared builder, COMMIT. The event therefore commits with the
// status change or not at all, and what can be checked without a database is
// the statement sequence and the event handed to the outbox insert.
//
// The behaviour only MySQL can settle - that a confirmation writes exactly
// one row, that a cancellation writes none, and that a conflict rolls the
// status change back - is proved in
// `admin-package-reservations.status.integration.test.ts`.
//
// Scope is Event 4 only. The transition rules, the 404/409 split and the HTTP
// contract are covered in `admin-package-reservations.status.test.ts`.

type RepositoryModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.repository.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let updateAdminPackageReservationStatus: RepositoryModule['updateAdminPackageReservationStatus'];

const REFERENCE = 'TPP-23456789ABCD';
const GUEST_EMAIL = 'amira@example.test';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests, updateAdminPackageReservationStatus } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.repository.js'
  ));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** The stored reservation, with its snapshots. */
function row(status: string) {
  return {
    booking_reference: REFERENCE,
    package_code_snapshot: 'T016',
    package_slug: 'nile-dinner-cruise',
    package_title_snapshot: 'Nile Dinner Cruise',
    variant_key: 'premium-service',
    variant_label_snapshot: 'Premium service',
    guest_first_name: 'Amira',
    guest_last_name: 'Hassan',
    guest_email: GUEST_EMAIL,
    guest_phone: '+201000000000',
    guest_country: 'Egypt',
    tour_date: '2026-10-01',
    adults: 2,
    children: 2,
    child_ages: [7, 9],
    special_requests: 'Window table if possible',
    status,
    pricing_status: 'quoted',
    currency: 'USD',
    adult_unit_rate_snapshot: '100.00',
    child_unit_rate_snapshot: '50.00',
    total_amount_snapshot: '300.00',
    created_at: new Date('2026-09-20T18:45:22.411Z'),
  };
}

type Recorded = { text: string; values: unknown[] | undefined };

/** Records every statement of the transaction; the lock read finds the row. */
function recording(options: { found?: boolean; error?: unknown; status?: string } = {}) {
  const state = { calls: [] as Recorded[], released: [] as unknown[] };

  __setQueryableForTests({
    async query() {
      throw new Error('the status change must run on a transaction connection');
    },
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          state.calls.push({ text, values });

          if (text.includes('FOR UPDATE OF u')) {
            return { rows: options.found === false ? [] : [row(options.status ?? 'pending')] } as never;
          }

          if (text.includes('INSERT INTO notification_outbox') && options.error) {
            throw options.error;
          }

          return { rows: [], rowCount: 1 } as never;
        },
        release(discard?: boolean) {
          state.released.push(discard);
        },
      };
    },
  } as never);

  return state;
}

const compact = (text: string): string => text.replace(/\s+/g, ' ').trim();
const outboxInsert = (state: { calls: Recorded[] }) =>
  state.calls.find((call) => call.text.includes('INSERT INTO notification_outbox'));

describe('the confirmation event travels inside the status transaction', () => {
  it('locks, updates, queues and commits, in that order', async () => {
    const state = recording();

    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const texts = state.calls.map((call) => compact(call.text));
    assert.equal(texts.length, 5);
    assert.equal(texts[0], 'BEGIN');
    assert.match(texts[1] ?? '', /FOR UPDATE OF u$/);
    assert.match(texts[2] ?? '', /^UPDATE package_reservations/);
    assert.match(texts[3] ?? '', /^INSERT INTO notification_outbox/);
    assert.equal(texts[4], 'COMMIT');
    assert.deepEqual(state.released, [false], 'the connection is returned normally');
  });

  it('queues only for a confirmation', async () => {
    const cancelled = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'cancelled');

    assert.equal(outboxInsert(cancelled), undefined, 'a cancellation owes the guest nothing here');
    assert.equal(
      cancelled.calls.map((call) => compact(call.text)).at(-1),
      'COMMIT',
      'and it still commits',
    );

    const confirmed = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');
    assert.ok(outboxInsert(confirmed));
  });

  it('writes no event when the transition is refused or the booking is missing', async () => {
    const refused = recording({ status: 'cancelled' });
    assert.deepEqual(await updateAdminPackageReservationStatus(REFERENCE, 'confirmed'), {
      outcome: 'invalid-transition',
    });
    assert.equal(outboxInsert(refused), undefined);
    assert.ok(!refused.calls.some((call) => call.text.includes('UPDATE package_reservations')));
    assert.equal(compact(refused.calls.at(-1)?.text ?? ''), 'ROLLBACK');

    const missing = recording({ found: false });
    assert.deepEqual(await updateAdminPackageReservationStatus(REFERENCE, 'confirmed'), {
      outcome: 'not-found',
    });
    assert.equal(outboxInsert(missing), undefined);
    assert.equal(compact(missing.calls.at(-1)?.text ?? ''), 'ROLLBACK');
  });

  it('carries no duplicate handling anywhere', async () => {
    // A conflict on (event_type, booking_reference) means a second
    // confirmation for a reference that is unique forever. Swallowing it would
    // drop a message the guest was owed.
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    for (const { text } of state.calls) {
      assert.doesNotMatch(text, /ON\s+DUPLICATE/i);
      assert.doesNotMatch(text, /INSERT\s+IGNORE/i);
    }
  });
});

describe('the confirmation event identity and payload', () => {
  it('names the event, recipient and template exactly', async () => {
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const values = outboxInsert(state)?.values ?? [];
    assert.deepEqual(values.slice(0, 5), [
      'package_reservation_confirmed',
      REFERENCE,
      'guest',
      GUEST_EMAIL,
      'package_confirmed_guest.v1',
    ]);
  });

  it('builds exactly the payload the shared builder defines', async () => {
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const expected = buildPackageReservationConfirmedEvent({
      bookingReference: REFERENCE,
      guestFirstName: 'Amira',
      guestLastName: 'Hassan',
      guestEmail: GUEST_EMAIL,
      packageTitle: 'Nile Dinner Cruise',
      variantLabel: 'Premium service',
      tourDate: '2026-10-01',
      adults: 2,
      children: 2,
      pricingStatus: 'quoted',
      adultUnitRate: '100.00',
      childUnitRate: '50.00',
      totalAmount: '300.00',
      specialRequests: 'Window table if possible',
    }).payload;

    const written = JSON.parse(String(outboxInsert(state)?.values?.[5]));
    assert.deepEqual(written, expected);
  });

  it('keeps the guest address, phone and country out of the payload', async () => {
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const keys = Object.keys(JSON.parse(String(outboxInsert(state)?.values?.[5])));
    assert.ok(!keys.includes('guestEmail'));
    assert.ok(!keys.includes('guestPhone'));
    assert.ok(!keys.includes('guestCountry'));
  });

  it('carries no internal id, slug or variant key', async () => {
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const payload = String(outboxInsert(state)?.values?.[5]);
    for (const forbidden of ['package_id', 'variant_id', 'nile-dinner-cruise', 'premium-service', 'T016']) {
      assert.ok(!payload.includes(forbidden), `the payload must not carry ${forbidden}`);
    }
  });

  it('keeps money as exact stored decimals and the tour date as a calendar day', async () => {
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const payload = JSON.parse(String(outboxInsert(state)?.values?.[5])) as Record<string, unknown>;
    assert.equal(payload.adultUnitRate, '100.00');
    assert.equal(payload.childUnitRate, '50.00');
    assert.equal(payload.totalAmount, '300.00');
    assert.equal(payload.tourDate, '2026-10-01');
    assert.equal(payload.currency, 'USD');
  });

  it('reads no environment and re-reads no row', async () => {
    const state = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    const selects = state.calls.filter((call) => /^\s*SELECT/i.test(call.text));
    assert.equal(selects.length, 1, 'one read: the locking read that decides the transition');
  });
});

describe('the existing behaviour is unchanged', () => {
  it('still returns the full detail on a confirmation', async () => {
    recording();
    const result = await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    assert.equal(result.outcome, 'updated');
    assert.ok(result.outcome === 'updated');
    assert.deepEqual(Object.keys(result.reservation).sort(), [
      'adultUnitRateSnapshot',
      'adults',
      'bookingReference',
      'childAges',
      'childUnitRateSnapshot',
      'children',
      'createdAt',
      'currency',
      'guestCountry',
      'guestEmail',
      'guestName',
      'guestPhone',
      'package',
      'pricingStatus',
      'specialRequests',
      'status',
      'totalAmountSnapshot',
      'tourDate',
      'variant',
    ]);
    assert.equal(result.reservation.status, 'confirmed');
  });

  it('propagates a database error unchanged and rolls the status change back', async () => {
    // A unique violation from the outbox insert aborts the transaction, status
    // change included, and arrives here as the driver raised it.
    const raised = Object.assign(new Error('Duplicate entry'), {
      code: '23505',
      constraint: 'notification_outbox_event_booking_key',
    });
    const state = recording({ error: raised });

    const thrown = await updateAdminPackageReservationStatus(REFERENCE, 'confirmed').then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised, 'the very same error object');
    assert.equal((thrown as { code: string }).code, '23505');
    assert.equal(compact(state.calls.at(-1)?.text ?? ''), 'ROLLBACK');
    assert.ok(!state.calls.some((call) => compact(call.text) === 'COMMIT'));
  });
});
