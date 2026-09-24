import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';

// Proves the room-type lock conflict against real PostgreSQL, with two real
// connections. Nothing is mocked and nothing is timed: the assertion is the
// SQLSTATE PostgreSQL raises when `lock_timeout` expires (55P03,
// lock_not_available), which only happens when a lock genuinely conflicts.
//
// A sleep-based test would prove nothing — it would pass just as happily if no
// lock were taken at all. `lock_timeout` turns "this blocks" into a value the
// database itself reports.
//
// It creates one room type with an identifier unique to this run and removes
// exactly that afterwards. No other data is read for assertions or deleted.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type PoolModule = typeof import('../src/db/pool.js');
type ReservationsRepository = typeof import('../src/modules/reservations/reservations.repository.js');
type AdminRoomTypesRepository =
  typeof import('../src/modules/admin-room-types/admin-room-types.repository.js');

let dbPool: PoolModule['dbPool'];
let closeDatabasePool: PoolModule['closeDatabasePool'];
let findActiveRoomTypeBySlug: ReservationsRepository['findActiveRoomTypeBySlug'];
let lockAdminRoomTypeBySlug: AdminRoomTypesRepository['lockAdminRoomTypeBySlug'];
let updateAdminRoomTypeCapacity: AdminRoomTypesRepository['updateAdminRoomTypeCapacity'];

const runId = randomUUID().slice(0, 8);
const slug = `itest-lock-${runId}`;

let roomTypeId = '';

/** PostgreSQL lock_not_available — what a lock_timeout expiry raises. */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Short enough that a blocked statement fails fast, long enough that a
 * *non*-blocking statement is never mistaken for a blocked one on a slow
 * machine. It bounds a failure, it does not schedule one.
 */
const LOCK_TIMEOUT_MS = 750;

function isLockNotAvailable(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE
  );
}

/**
 * Runs a statement that is expected to block, with a bounded wait, and returns
 * whether PostgreSQL refused it for lack of the lock.
 *
 * The client is always rolled back, so a failed expectation cannot leave a
 * transaction holding locks for the rest of the suite.
 */
async function expectsBlocked(client: PoolClient, attempt: () => Promise<unknown>): Promise<boolean> {
  await client.query('BEGIN');

  try {
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await attempt();
    return false;
  } catch (error) {
    if (isLockNotAvailable(error)) {
      return true;
    }

    throw error;
  } finally {
    await client.query('ROLLBACK');
  }
}

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));
  ({ findActiveRoomTypeBySlug } = await import('../src/modules/reservations/reservations.repository.js'));
  ({ lockAdminRoomTypeBySlug, updateAdminRoomTypeCapacity } = await import(
    '../src/modules/admin-room-types/admin-room-types.repository.js'
  ));

  const { rows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 4, '1000.00', true, 0)
     RETURNING id`,
    [slug, `Lock Fixture ${runId}`],
  );

  roomTypeId = rows[0]!.id;
});

after(async () => {
  try {
    // No rooms and no reservations are created by this suite, so the room type
    // is the only fixture to remove.
    await dbPool.query('DELETE FROM room_types WHERE id = $1::bigint', [roomTypeId]);

    const { rows } = await dbPool.query<{ types: number }>(
      'SELECT (SELECT COUNT(*) FROM room_types WHERE id = $1::bigint)::int AS types',
      [roomTypeId],
    );

    assert.deepEqual(rows[0], { types: 0 }, 'fixtures were not fully removed');
  } finally {
    await closeDatabasePool();
  }
});

describe('booking FOR KEY SHARE vs admin FOR UPDATE on room_types', () => {
  it('CASE 1 - a booking lookup blocks an admin capacity lock until it ends', async () => {
    const booking = await dbPool.connect();
    const admin = await dbPool.connect();

    try {
      // Client A: take the booking path's key-share lock and hold it.
      await booking.query('BEGIN');
      const roomType = await findActiveRoomTypeBySlug(booking, slug);

      assert.ok(roomType, 'the fixture room type should be found by the booking lookup');
      assert.equal(roomType.slug, slug);
      assert.equal(roomType.capacity, 4);

      // Client B: the admin exclusive lock must not be available.
      const blocked = await expectsBlocked(admin, () => lockAdminRoomTypeBySlug(admin, slug));

      assert.ok(blocked, 'admin FOR UPDATE should have been refused while a booking holds FOR KEY SHARE');

      // Client A releases.
      await booking.query('ROLLBACK');

      // Client B: the same lock now succeeds, in a fresh transaction.
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
        const locked = await lockAdminRoomTypeBySlug(admin, slug);

        assert.ok(locked, 'admin FOR UPDATE should succeed once the booking transaction has ended');
        assert.equal(locked.slug, slug);
        assert.equal(locked.roomTypeId, roomTypeId);
      } finally {
        await admin.query('ROLLBACK');
      }
    } finally {
      // Belt and braces: a failed assertion above must not leak an open
      // transaction into the next test.
      await booking.query('ROLLBACK').catch(() => undefined);
      booking.release();
      admin.release();
    }
  });

  it('CASE 2 - an admin capacity lock blocks a booking lookup, which then sees the committed capacity', async () => {
    const admin = await dbPool.connect();
    const booking = await dbPool.connect();

    try {
      // Client A: take the admin exclusive lock and change capacity, uncommitted.
      await admin.query('BEGIN');
      const locked = await lockAdminRoomTypeBySlug(admin, slug);

      assert.ok(locked, 'the fixture room type should be lockable');
      assert.equal(locked.capacity, 4);

      const updated = await updateAdminRoomTypeCapacity(admin, locked.roomTypeId, 2);

      assert.ok(updated);
      assert.equal(updated.capacity, 2);

      // Client B: the booking lookup must not be available.
      const blocked = await expectsBlocked(booking, () => findActiveRoomTypeBySlug(booking, slug));

      assert.ok(blocked, 'the booking lookup should have been refused while an admin holds FOR UPDATE');

      // Client A commits the capacity change.
      await admin.query('COMMIT');

      // Client B: the lookup now succeeds and — this is the point of the whole
      // exercise — reads the capacity that was just committed, not the value it
      // would have read had it not waited. Under READ COMMITTED the locking
      // SELECT re-reads the current row version after the wait, so the booking's
      // own capacity check runs against 2 rather than the stale 4.
      await booking.query('BEGIN');
      try {
        const roomType = await findActiveRoomTypeBySlug(booking, slug);

        assert.ok(roomType, 'the booking lookup should succeed once the admin transaction has committed');
        assert.equal(roomType.capacity, 2, 'the booking must see the committed capacity, never the stale one');
      } finally {
        await booking.query('ROLLBACK');
      }
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
      admin.release();
      booking.release();
    }
  });

  it('CASE 3 - an ordinary non-key UPDATE is not blocked by a booking lookup', async () => {
    // The reason this lock is KEY SHARE and not SHARE.
    //
    // An UPDATE that leaves `id` and `slug` alone acquires FOR NO KEY UPDATE,
    // which is compatible with FOR KEY SHARE but conflicts with FOR SHARE.
    // Every field of the T01 partial update is such a column, so with SHARE
    // here, editing a description would wait behind every in-flight booking on
    // that room type — for nothing, since the serialisation that matters comes
    // from the administrator's explicit FOR UPDATE.
    //
    // If this test ever starts failing with 55P03, the lock has been
    // strengthened and that cost has been reintroduced.
    const booking = await dbPool.connect();
    const editor = await dbPool.connect();

    try {
      await booking.query('BEGIN');
      const held = await findActiveRoomTypeBySlug(booking, slug);
      assert.ok(held, 'the fixture room type should be found by the booking lookup');

      await editor.query('BEGIN');
      try {
        await editor.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

        // A harmless non-key column, exactly as T01's PATCH would write it.
        const { rowCount } = await editor.query(
          `UPDATE room_types
              SET short_description = $2,
                  updated_at = now()
            WHERE slug = $1`,
          [slug, `edited during a booking ${runId}`],
        );

        assert.equal(rowCount, 1, 'a descriptive edit must not be blocked by a booking lookup');
      } finally {
        // Rolled back, so the fixture is restored and nothing this case wrote
        // survives into the next test.
        await editor.query('ROLLBACK');
      }

      await booking.query('ROLLBACK');

      // The rollback really did restore it.
      const { rows } = await dbPool.query<{ short_description: string | null }>(
        'SELECT short_description FROM room_types WHERE slug = $1',
        [slug],
      );
      assert.equal(rows[0]?.short_description, null, 'the fixture should be unchanged after rollback');
    } finally {
      await booking.query('ROLLBACK').catch(() => undefined);
      await editor.query('ROLLBACK').catch(() => undefined);
      booking.release();
      editor.release();
    }
  });

  it('CASE 4 - two concurrent booking lookups do not block each other', async () => {
    // FOR KEY SHARE is shared: bookings queue behind an administrator, never behind
    // one another. If this ever blocks, the lock has been made too strong and
    // every booking on a popular room type has been serialised.
    const first = await dbPool.connect();
    const second = await dbPool.connect();

    try {
      await first.query('BEGIN');
      const held = await findActiveRoomTypeBySlug(first, slug);
      assert.ok(held);

      await second.query('BEGIN');
      await second.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      const concurrent = await findActiveRoomTypeBySlug(second, slug);

      assert.ok(concurrent, 'a second booking lookup must not be blocked by the first');
      assert.equal(concurrent.slug, slug);

      await second.query('ROLLBACK');
      await first.query('ROLLBACK');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });
});
