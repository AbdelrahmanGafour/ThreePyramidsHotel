import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PoolClient } from '../src/db/pool';
import { insertedId, toNumbers } from './support/core-sql';

// Proves the room-type lock conflict against real MySQL, with two real
// connections. Nothing is mocked and nothing is timed: the assertion is the
// code the adapter reports when `innodb_lock_wait_timeout` expires (40001,
// ER_LOCK_WAIT_TIMEOUT), which only happens when a lock genuinely conflicts.
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

/** The adapter's code for a MySQL lock wait timeout (ER_LOCK_WAIT_TIMEOUT, 1205). */
const LOCK_NOT_AVAILABLE = '40001';

/**
 * Short enough that a blocked statement fails fast, long enough that a
 * *non*-blocking statement is never mistaken for a blocked one on a slow
 * machine. It bounds a failure, it does not schedule one.
 */
const LOCK_TIMEOUT_MS = 750;

/**
 * MySQL's smallest lock wait is whole seconds (`innodb_lock_wait_timeout`),
 * set per session BEFORE the transaction starts. Pooled connections keep the
 * session value, so `releaseClient` restores the default first.
 */
const LOCK_WAIT_SECONDS = 1;

async function useShortLockWait(client: PoolClient): Promise<void> {
  await client.query(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
}

async function releaseClient(client: PoolClient): Promise<void> {
  await client.query('SET SESSION innodb_lock_wait_timeout = DEFAULT').catch(() => undefined);
  client.release();
}

function isLockNotAvailable(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE
  );
}

/**
 * Runs a statement that is expected to block, with a bounded wait, and returns
 * whether MySQL refused it for lack of the lock.
 *
 * The client is always rolled back, so a failed expectation cannot leave a
 * transaction holding locks for the rest of the suite.
 */
async function expectsBlocked(client: PoolClient, attempt: () => Promise<unknown>): Promise<boolean> {
  await useShortLockWait(client);
  await client.query('BEGIN');

  try {
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

  const inserted = await dbPool.query(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, 4, '1000.00', true, 0)`,
    [slug, `Lock Fixture ${runId}`],
  );

  roomTypeId = insertedId(inserted);
});

after(async () => {
  try {
    // No rooms and no reservations are created by this suite, so the room type
    // is the only fixture to remove.
    await dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);

    const { rows } = await dbPool.query<{ types: number }>(
      'SELECT (SELECT COUNT(*) FROM room_types WHERE id = $1) AS types',
      [roomTypeId],
    );

    assert.deepEqual(rows[0] && toNumbers(rows[0]), { types: 0 }, 'fixtures were not fully removed');
  } finally {
    await closeDatabasePool();
  }
});

describe('booking FOR SHARE vs admin FOR UPDATE on room_types', () => {
  it('CASE 1 - a booking lookup blocks an admin capacity lock until it ends', async () => {
    const booking = await dbPool.connect();
    const admin = await dbPool.connect();

    try {
      // Client A: take the booking path's shared lock and hold it.
      await booking.query('BEGIN');
      const roomType = await findActiveRoomTypeBySlug(booking, slug);

      assert.ok(roomType, 'the fixture room type should be found by the booking lookup');
      assert.equal(roomType.slug, slug);
      assert.equal(roomType.capacity, 4);

      // Client B: the admin exclusive lock must not be available.
      const blocked = await expectsBlocked(admin, () => lockAdminRoomTypeBySlug(admin, slug));

      assert.ok(blocked, 'admin FOR UPDATE should have been refused while a booking holds FOR SHARE');

      // Client A releases.
      await booking.query('ROLLBACK');

      // Client B: the same lock now succeeds, in a fresh transaction.
      await admin.query('BEGIN');
      try {
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
      await releaseClient(booking);
      await releaseClient(admin);
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
      await releaseClient(admin);
      await releaseClient(booking);
    }
  });

  it('CASE 3 - an ordinary UPDATE queues behind a booking lookup (unlike PostgreSQL FOR KEY SHARE)', async () => {
    // MySQL has no FOR KEY SHARE / FOR NO KEY UPDATE split: the booking path
    // holds a plain shared row lock, and ANY write to the row, even a
    // descriptive column, waits for it. This case pins that known difference
    // so it is a documented behaviour rather than a surprise. The wait is
    // brief in practice (a booking transaction is short) and it is the price
    // of the in-app overlap/capacity guarantees.
    const booking = await dbPool.connect();
    const editor = await dbPool.connect();

    try {
      await booking.query('BEGIN');
      const held = await findActiveRoomTypeBySlug(booking, slug);
      assert.ok(held, 'the fixture room type should be found by the booking lookup');

      const blocked = await expectsBlocked(editor, () =>
        editor.query(
          `UPDATE room_types
              SET short_description = $2,
                  updated_at = UTC_TIMESTAMP(3)
            WHERE slug = $1`,
          [slug, `edited during a booking ${runId}`],
        ),
      );

      assert.ok(blocked, 'a write to the row waits for an in-flight booking lookup');

      await booking.query('ROLLBACK');

      // The blocked UPDATE never applied.
      const { rows } = await dbPool.query<{ short_description: string | null }>(
        'SELECT short_description FROM room_types WHERE slug = $1',
        [slug],
      );
      assert.equal(rows[0]?.short_description, null, 'the fixture should be unchanged');
    } finally {
      await booking.query('ROLLBACK').catch(() => undefined);
      await editor.query('ROLLBACK').catch(() => undefined);
      await releaseClient(booking);
      await releaseClient(editor);
    }
  });

  it('CASE 4 - two concurrent booking lookups do not block each other', async () => {
    // FOR SHARE is shared: bookings queue behind an administrator, never behind
    // one another. If this ever blocks, the lock has been made too strong and
    // every booking on a popular room type has been serialised.
    const first = await dbPool.connect();
    const second = await dbPool.connect();

    try {
      await first.query('BEGIN');
      const held = await findActiveRoomTypeBySlug(first, slug);
      assert.ok(held);

      await useShortLockWait(second);
      await second.query('BEGIN');
      const concurrent = await findActiveRoomTypeBySlug(second, slug);

      assert.ok(concurrent, 'a second booking lookup must not be blocked by the first');
      assert.equal(concurrent.slug, slug);

      await second.query('ROLLBACK');
      await first.query('ROLLBACK');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await releaseClient(first);
      await releaseClient(second);
    }
  });
});
