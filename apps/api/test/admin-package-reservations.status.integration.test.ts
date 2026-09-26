import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

// The admin package reservation status transition against real PostgreSQL.
//
// The unit suite models the conditional UPDATE's concurrency guarantee; this
// one proves it. The guarantee is PostgreSQL's own: under READ COMMITTED, a
// writer that blocks on a row lock re-evaluates its WHERE clause against the
// version the lock holder committed (EvalPlanQual). Nothing but the database
// can demonstrate that, so it is demonstrated here rather than asserted.
//
// Nothing is mocked. The repository is called exactly as the controller calls
// it, through the real pool. Every row this suite writes carries an
// identifier unique to the run, and exactly those rows are removed afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type RepositoryModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.repository.js');
type ReferenceModule = typeof import('../src/modules/package-reservations/booking-reference.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let updateAdminPackageReservationStatus: RepositoryModule['updateAdminPackageReservationStatus'];
let generatePackageBookingReference: ReferenceModule['generatePackageBookingReference'];

const runId = randomUUID().slice(0, 8);
const codePrefix = `ITEST-${runId}`;
const slugPrefix = `itest-pkgstatus-${runId}`;

let packageId = '';
let variantId = '';

/** Every reservation this suite creates, so cleanup names exactly them. */
const createdReferences: string[] = [];

/** The columns that must survive a status change untouched. */
const SNAPSHOT_COLUMNS = [
  'booking_reference',
  'package_id',
  'variant_id',
  'tour_date',
  'adults',
  'children',
  'child_ages',
  'guest_first_name',
  'guest_last_name',
  'guest_email',
  'guest_phone',
  'guest_country',
  'special_requests',
  'pricing_status',
  'package_code_snapshot',
  'package_title_snapshot',
  'variant_label_snapshot',
  'currency',
  'adult_unit_rate_snapshot',
  'child_unit_rate_snapshot',
  'total_amount_snapshot',
  'created_at',
] as const;

async function readRow(bookingReference: string): Promise<Record<string, unknown>> {
  const { rows } = await dbPool.query<Record<string, unknown>>(
    `SELECT ${SNAPSHOT_COLUMNS.join(', ')}, status, updated_at
       FROM package_reservations
      WHERE booking_reference = $1`,
    [bookingReference],
  );

  const row = rows[0];
  assert.ok(row, `fixture reservation ${bookingReference} should exist`);

  return row;
}

function snapshotOf(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SNAPSHOT_COLUMNS.map((column) => [column, row[column]]));
}

/**
 * One pending reservation, priced so the schema's own total CHECK is
 * satisfied: 2 adults at 100.00, no children, total 200.00.
 */
async function createPendingReservation(): Promise<string> {
  const bookingReference = generatePackageBookingReference();

  await dbPool.query(
    `INSERT INTO package_reservations (
       booking_reference, package_id, variant_id, tour_date, adults, children,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       status, pricing_status,
       package_code_snapshot, package_title_snapshot, variant_label_snapshot,
       currency, adult_unit_rate_snapshot, child_unit_rate_snapshot, total_amount_snapshot
     ) VALUES (
       $1, $2, $3, DATE '2026-10-01', 2, 0,
       'Amira', 'Hassan', 'amira@example.test', '+201000000000', 'Egypt',
       'pending', 'quoted',
       $4, 'Fixture package', 'Fixture variant',
       'USD', '100.00', NULL, '200.00'
     )`,
    [bookingReference, packageId, variantId, `${codePrefix}-A`],
  );

  createdReferences.push(bookingReference);

  return bookingReference;
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ updateAdminPackageReservationStatus } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.repository.js'
  ));
  ({ generatePackageBookingReference } = await import(
    '../src/modules/package-reservations/booking-reference.js'
  ));

  const { rows: packageRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO packages (code, slug, title, is_active, requires_price_confirmation, sort_order)
     VALUES ($1, $2, 'Fixture package', false, false, 0)
     RETURNING id`,
    [`${codePrefix}-A`, `${slugPrefix}-a`],
  );
  packageId = packageRows[0]!.id;

  const { rows: variantRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO package_variants (package_id, key, label, is_default, sort_order)
     VALUES ($1, 'standard', 'Fixture variant', true, 0)
     RETURNING id`,
    [packageId],
  );
  variantId = variantRows[0]!.id;
});

after(async () => {
  // Reservations first: they hold the RESTRICT foreign key to the variant.
  await dbPool.query('DELETE FROM package_reservations WHERE booking_reference = ANY($1::text[])', [
    createdReferences,
  ]);
  await dbPool.query('DELETE FROM package_variants WHERE package_id = $1', [packageId]);
  await dbPool.query('DELETE FROM packages WHERE code LIKE $1', [`${codePrefix}%`]);

  await closeDatabasePool();
});

let bookingReference = '';

beforeEach(async () => {
  bookingReference = await createPendingReservation();
});

describe('package reservation status transitions against PostgreSQL', () => {
  it('lets exactly one of two concurrent transitions win', async () => {
    const before = snapshotOf(await readRow(bookingReference));

    // Two genuinely concurrent statements: the pool hands each call its own
    // connection, so these race in the database rather than in this process.
    const [confirming, cancelling] = await Promise.all([
      updateAdminPackageReservationStatus(bookingReference, 'confirmed'),
      updateAdminPackageReservationStatus(bookingReference, 'cancelled'),
    ]);

    const outcomes = [confirming.outcome, cancelling.outcome].sort();
    assert.deepEqual(outcomes, ['invalid-transition', 'updated'], 'exactly one must win');

    const winner = confirming.outcome === 'updated' ? confirming : cancelling;
    assert.equal(winner.outcome, 'updated');

    const stored = await readRow(bookingReference);
    assert.equal(
      stored.status,
      winner.reservation.status,
      'the stored status must be exactly the winner\'s terminal status',
    );
    assert.ok(['confirmed', 'cancelled'].includes(stored.status as string));

    // Nothing but the status moved.
    assert.deepEqual(snapshotOf(stored), before);
  });

  it('makes the loser block on the row lock and then refuse, deterministically', async () => {
    // The race above cannot say WHICH statement waited. This one forces it: a
    // held transaction owns the row, so the repository's UPDATE must block on
    // the lock and, when released, re-evaluate its WHERE against the row the
    // holder committed. That re-evaluation is the whole guarantee.
    const holder: PoolClient = await dbPool.connect();
    let settled = false;

    try {
      await holder.query('BEGIN');
      const held = await holder.query(
        `UPDATE package_reservations
            SET status = 'cancelled', updated_at = now()
          WHERE booking_reference = $1
            AND status = 'pending'`,
        [bookingReference],
      );
      assert.equal(held.rowCount, 1, 'the holder should take the pending row');

      // Not awaited yet: it is expected to be blocked by the holder's lock.
      const blocked = updateAdminPackageReservationStatus(bookingReference, 'confirmed').then(
        (result) => {
          settled = true;
          return result;
        },
      );

      // Give it a real chance to finish if it were not blocked. Proving it
      // waited needs an observation while the lock is still held.
      await dbPool.query("SELECT pg_sleep(0.25)");
      assert.equal(settled, false, 'the competing transition must be waiting on the row lock');

      await holder.query('COMMIT');

      const result = await blocked;
      assert.equal(
        result.outcome,
        'invalid-transition',
        'after the lock is released the row is no longer pending, so the write matches nothing',
      );
    } finally {
      // Safe whether or not COMMIT ran: a committed transaction rolls back to
      // nothing, and an open one is released rather than leaked.
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }

    const stored = await readRow(bookingReference);
    assert.equal(stored.status, 'cancelled', 'the committed terminal status stands');
  });

  it('cannot overwrite an already-terminal row, in either direction', async () => {
    const first = await updateAdminPackageReservationStatus(bookingReference, 'confirmed');
    assert.equal(first.outcome, 'updated');

    const afterWin = await readRow(bookingReference);
    assert.equal(afterWin.status, 'confirmed');

    for (const target of ['confirmed', 'cancelled'] as const) {
      const refused = await updateAdminPackageReservationStatus(bookingReference, target);
      assert.equal(refused.outcome, 'invalid-transition', `confirmed -> ${target} must be refused`);
    }

    const afterAttempts = await readRow(bookingReference);
    assert.equal(afterAttempts.status, 'confirmed');
    // Logically written once: a refused attempt does not touch the row, so
    // even updated_at is unmoved.
    assert.deepEqual(afterAttempts.updated_at, afterWin.updated_at, 'a refusal must not write');
    assert.deepEqual(snapshotOf(afterAttempts), snapshotOf(afterWin));
  });

  it('refuses every move out of cancelled too', async () => {
    const cancelled = await updateAdminPackageReservationStatus(bookingReference, 'cancelled');
    assert.equal(cancelled.outcome, 'updated');

    const afterWin = await readRow(bookingReference);

    for (const target of ['confirmed', 'cancelled'] as const) {
      const refused = await updateAdminPackageReservationStatus(bookingReference, target);
      assert.equal(refused.outcome, 'invalid-transition', `cancelled -> ${target} must be refused`);
    }

    const stored = await readRow(bookingReference);
    assert.equal(stored.status, 'cancelled');
    assert.deepEqual(stored.updated_at, afterWin.updated_at);
  });

  it('writes updated_at exactly once across a winning transition', async () => {
    const before = await readRow(bookingReference);

    const result = await updateAdminPackageReservationStatus(bookingReference, 'confirmed');
    assert.equal(result.outcome, 'updated');

    const afterFirst = await readRow(bookingReference);
    assert.notDeepEqual(afterFirst.updated_at, before.updated_at, 'the winning write moves updated_at');

    // Every subsequent attempt matches nothing, so the row stops moving.
    await updateAdminPackageReservationStatus(bookingReference, 'cancelled');
    const afterSecond = await readRow(bookingReference);
    assert.deepEqual(afterSecond.updated_at, afterFirst.updated_at);
  });

  it('answers not-found for a well-formed reference nobody booked', async () => {
    const unknown = generatePackageBookingReference();
    const result = await updateAdminPackageReservationStatus(unknown, 'confirmed');

    assert.equal(result.outcome, 'not-found');
  });

  it('returns the joined detail, with snapshots and no database ids', async () => {
    const result = await updateAdminPackageReservationStatus(bookingReference, 'confirmed');
    assert.equal(result.outcome, 'updated');

    const { reservation } = result;
    assert.equal(reservation.bookingReference, bookingReference);
    assert.equal(reservation.status, 'confirmed');
    // Read from the live rows through the CTE's joins.
    assert.equal(reservation.package.slug, `${slugPrefix}-a`);
    assert.equal(reservation.variant.key, 'standard');
    // Read from the reservation's own snapshots, exactly as stored.
    assert.equal(reservation.package.code, `${codePrefix}-A`);
    assert.equal(reservation.package.title, 'Fixture package');
    assert.equal(reservation.variant.label, 'Fixture variant');
    assert.equal(reservation.adultUnitRateSnapshot, '100.00');
    assert.equal(reservation.childUnitRateSnapshot, null);
    assert.equal(reservation.totalAmountSnapshot, '200.00');
    assert.equal(reservation.currency, 'USD');
    assert.equal(reservation.tourDate, '2026-10-01');

    const serialized = JSON.stringify(reservation);
    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not leave the repository`);
    }
  });
});
