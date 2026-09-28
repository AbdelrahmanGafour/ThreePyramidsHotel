import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { buildPackageReservationConfirmedEvent } from '../src/modules/notifications/notifications.events';

// The guest confirmation for a journey, which rides inside the status UPDATE.
//
// This path has no transaction — the status change is deliberately one
// statement — so the event is a data-modifying CTE rather than a second query.
// That makes the SQL itself the contract, and most of what can be checked
// without a database is structural: that there is ONE statement, that the
// event CTE depends on the UPDATE, that it carries the right identity, and
// that its payload matches the builder the other three events use.
//
// The behaviour only PostgreSQL can settle — that a confirmation writes
// exactly one row, that a cancellation writes none, and that a conflict aborts
// the UPDATE with it — is proved in
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

/** Records every statement and answers the UPDATE with the given rows. */
function recording(options: { updates?: boolean; error?: unknown } = {}) {
  const state = { calls: [] as Recorded[] };

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });

      if (text.includes('UPDATE package_reservations')) {
        if (options.error) {
          throw options.error;
        }
        const next = values?.[1] as string;
        return { rows: options.updates === false ? [] : [row(next)] } as never;
      }

      return { rows: [{ booking_reference: REFERENCE }] } as never;
    },
  } as never);

  return state;
}

/** Runs one confirmation against a recording double and returns its SQL. */
async function confirmedStatement(): Promise<string> {
  const state = recording();

  await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

  return statusStatement(state);
}

const statusStatement = (state: { calls: Recorded[] }): string => {
  const call = state.calls.find((entry) => entry.text.includes('UPDATE package_reservations'));

  assert.ok(call, 'expected the status statement');

  return call.text;
};

/** The payload keys the SQL builds, in the order it names them. */
function payloadKeysInSql(sql: string): string[] {
  const block = /jsonb_build_object\(([\s\S]*?)\n\s*\)/.exec(sql)?.[1];

  assert.ok(block, 'expected a jsonb_build_object payload');

  // Keys are the quoted strings immediately followed by a comma; every value
  // is either `u.column`, a cast, or a cast literal, so none can match.
  return [...block.matchAll(/'([A-Za-z]+)',/g)].map((match) => match[1] as string);
}

describe('the confirmation event travels inside the status statement', () => {
  it('issues one statement that both updates and queues', async () => {
    // No transaction exists on this path, so a second statement could commit
    // apart from the status change. One statement is already atomic.
    const state = recording();

    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    assert.equal(state.calls.length, 1, 'exactly one database call for a successful confirmation');

    const sql = state.calls[0]?.text ?? '';
    assert.match(sql, /UPDATE package_reservations/);
    assert.match(sql, /INSERT INTO notification_outbox/);
  });

  it('makes the event a data-modifying CTE that depends on the UPDATE', async () => {
    const sql = await confirmedStatement();

    assert.match(sql, /WITH updated AS \(/, 'the UPDATE is still the first CTE');
    assert.match(sql, /notification_event AS \(\s*INSERT INTO notification_outbox/);
    // Selecting FROM updated is what ties the event to the write: no matched
    // row, no event.
    assert.match(sql, /FROM updated u\s*\n\s*WHERE u\.status = 'confirmed'/);
  });

  it('queues only for a confirmation', async () => {
    // The CTE's own WHERE, not a branch in TypeScript. A cancellation runs the
    // same statement and selects no row to insert.
    const confirming = await confirmedStatement();
    assert.match(confirming, /WHERE u\.status = 'confirmed'/);

    const cancelled = recording();
    await updateAdminPackageReservationStatus(REFERENCE, 'cancelled');

    assert.equal(cancelled.calls.length, 1, 'a cancellation is still one statement');
    assert.equal(statusStatement(cancelled), confirming, 'and it is the very same statement');
  });

  it('adds no second call for the event on any outcome', async () => {
    // Not found and a refused transition each cost one diagnosis read, exactly
    // as before. Neither gains a call, and neither can write an event because
    // `updated` is empty.
    const missing = recording({ updates: false });

    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    assert.equal(missing.calls.length, 2, 'the write plus the existing 404/409 diagnosis read');
    assert.ok(!missing.calls[1]?.text.includes('notification_outbox'), 'the second read is not about events');
  });

  it('carries no ON CONFLICT anywhere', async () => {
    // A conflict on (event_type, booking_reference) means a second
    // confirmation for a reference that is unique forever. Swallowing it would
    // drop a message the guest was owed.
    const sql = await confirmedStatement();

    assert.doesNotMatch(sql, /ON\s+CONFLICT/i);
    assert.doesNotMatch(sql, /DO\s+NOTHING/i);
    assert.doesNotMatch(sql, /DO\s+UPDATE/i);
  });

  it('opens no transaction', async () => {
    const state = recording();

    await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    for (const { text } of state.calls) {
      assert.doesNotMatch(text, /\bBEGIN\b/i);
      assert.doesNotMatch(text, /\bCOMMIT\b/i);
      assert.doesNotMatch(text, /\bROLLBACK\b/i);
    }
  });
});

describe('the confirmation event identity and payload', () => {
  it('names the event, recipient and template exactly', async () => {
    const sql = await confirmedStatement();

    assert.match(sql, /SELECT 'package_reservation_confirmed',/);
    assert.match(sql, /'guest',/);
    assert.match(sql, /'package_confirmed_guest\.v1',/);
    // The reference comes from the row that was just updated, not the input
    // parameter, so it can only be a booking that actually changed.
    assert.match(sql, /u\.booking_reference,/);
  });

  it('writes the six columns the outbox takes at insert, and no others', async () => {
    const columns = /INSERT INTO notification_outbox\s*\n\s*\(([^)]*)\)/.exec(
      await confirmedStatement(),
    )?.[1];

    assert.ok(columns, 'the insert lists its columns');
    assert.deepEqual(
      columns.split(',').map((column) => column.trim()),
      ['event_type', 'booking_reference', 'recipient_kind', 'recipient_email', 'template_key', 'payload'],
    );
  });

  it('addresses the guest through recipient_email, from the reservation snapshot', async () => {
    assert.match(await confirmedStatement(), /'guest',\s*\n\s*u\.guest_email,/);
  });

  it('builds exactly the payload the shared builder defines', async () => {
    // The one assertion that keeps this SQL honest. The other three events go
    // through `buildPackageReservationConfirmedEvent`; this one cannot,
    // because assembling it in TypeScript would need the row read back — the
    // second statement this design exists to avoid. So the contract is pinned
    // against the builder itself rather than against a copied list.
    const expected = Object.keys(
      buildPackageReservationConfirmedEvent({
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
      }).payload,
    );

    assert.deepEqual(payloadKeysInSql(await confirmedStatement()), expected);
  });

  it('keeps the guest address out of the payload', async () => {
    // It is the destination, not content. `guest_email` appears once in the
    // event, as the recipient column.
    const keys = payloadKeysInSql(await confirmedStatement());

    assert.ok(!keys.includes('guestEmail'));
    assert.ok(!keys.includes('guestPhone'));
    assert.ok(!keys.includes('guestCountry'));
  });

  it('carries no internal id, slug or variant key', async () => {
    const block = /jsonb_build_object\(([\s\S]*?)\n\s*\)/.exec(await confirmedStatement())?.[1] ?? '';

    for (const forbidden of ['package_id', 'variant_id', 'u.id', 'p.slug', 'pv.key', 'package_code']) {
      assert.ok(!block.includes(forbidden), `the payload must not carry ${forbidden}`);
    }
  });

  it('keeps money as exact stored decimals and the tour date as a calendar day', async () => {
    const block = /jsonb_build_object\(([\s\S]*?)\n\s*\)/.exec(await confirmedStatement())?.[1] ?? '';

    // ::text, never a float and never a rounded number.
    assert.match(block, /'adultUnitRate', u\.adult_unit_rate_snapshot::text/);
    assert.match(block, /'childUnitRate', u\.child_unit_rate_snapshot::text/);
    assert.match(block, /'totalAmount', u\.total_amount_snapshot::text/);
    assert.match(block, /'tourDate', u\.tour_date::text/);
    assert.match(block, /'currency', 'USD'::text/);
  });

  it('reads no environment and re-reads no row', async () => {
    const sql = await confirmedStatement();

    assert.ok(!sql.includes('current_setting'));
    // One reference to the reservations table: the UPDATE itself.
    assert.equal(sql.match(/package_reservations/g)?.length, 1);
  });
});

describe('the existing behaviour is unchanged', () => {
  it('still returns the full detail on a confirmation', async () => {
    const result = await (async () => {
      recording();
      return updateAdminPackageReservationStatus(REFERENCE, 'confirmed');
    })();

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

  it('still reports a refused transition as invalid-transition', async () => {
    recording({ updates: false });

    const result = await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    assert.deepEqual(result, { outcome: 'invalid-transition' });
  });

  it('still reports a missing reservation as not-found', async () => {
    __setQueryableForTests({
      async query() {
        return { rows: [] } as never;
      },
    } as never);

    const result = await updateAdminPackageReservationStatus(REFERENCE, 'confirmed');

    assert.deepEqual(result, { outcome: 'not-found' });
  });

  it('propagates a database error unchanged, object identity included', async () => {
    // A unique violation from the outbox insert aborts the whole statement,
    // status change included, and arrives here as the driver raised it.
    const raised = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'notification_outbox_event_booking_key',
    });
    recording({ error: raised });

    const thrown = await updateAdminPackageReservationStatus(REFERENCE, 'confirmed').then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised, 'the very same error object');
    assert.equal((thrown as { code: string }).code, '23505');
  });
});
