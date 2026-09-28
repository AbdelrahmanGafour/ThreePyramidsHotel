import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

// Runs against a real PostgreSQL database. It creates its own room type and
// physical rooms with unique identifiers, never touching the development seed
// or any other data, and removes them afterwards.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type AvailabilityService = typeof import('../src/modules/availability/availability.service.js');
type ReservationsService = typeof import('../src/modules/reservations/reservations.service.js');
type ReservationsTypes = typeof import('../src/modules/reservations/reservations.types.js');
type Pool = typeof import('../src/db/pool.js');

let getAvailability: AvailabilityService['getAvailability'];
let createReservation: ReservationsService['createReservation'];
let __setClientFactoryForTests: ReservationsService['__setClientFactoryForTests'];
let isNoAvailabilityError: ReservationsTypes['isNoAvailabilityError'];
let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];

// Unique per run so parallel runs (or a leftover failure) can never collide.
const runId = randomUUID().slice(0, 8);
const fixture = {
  slug: `itest-room-type-${runId}`,
  name: `Integration Test Room ${runId}`,
  capacity: 2,
  baseNightlyRate: '1234.50',
  roomNumbers: [`IT-${runId}-1`, `IT-${runId}-2`],
};

let roomTypeId: string;
let roomIds: string[] = [];

/**
 * References whose reservation is deleted mid-suite, so the outbox row they
 * left behind can still be found at cleanup time.
 */
const outboxReferences: string[] = [];

const guest = (email: string) => ({
  guestFirstName: 'Integration',
  guestLastName: 'Test',
  guestEmail: email,
  guestPhone: '+201000000000',
  guestCountry: 'Egypt',
});

async function insertDirectReservation(input: {
  roomId: string;
  checkIn: string;
  checkOut: string;
  status: 'pending' | 'confirmed' | 'cancelled';
}): Promise<string> {
  const bookingReference = `ITEST-${randomUUID().slice(0, 12).toUpperCase()}`;

  await dbPool.query(
    `INSERT INTO reservations (
       booking_reference, room_type_id, room_id,
       guest_first_name, guest_last_name, guest_email, guest_phone, guest_country,
       adults, children, check_in, check_out,
       status, currency, nightly_rate_snapshot, total_amount, special_requests
     )
     VALUES ($1, $2, $3, 'Fixture', 'Reservation', $4, '+201000000000', 'Egypt',
             2, 0, $5::date, $6::date, $7, 'EGP', $8, $8, NULL)`,
    [
      bookingReference,
      roomTypeId,
      input.roomId,
      `fixture-${runId}@example.com`,
      input.checkIn,
      input.checkOut,
      input.status,
      fixture.baseNightlyRate,
    ],
  );

  return bookingReference;
}

async function deleteDirectReservation(bookingReference: string): Promise<void> {
  await dbPool.query('DELETE FROM reservations WHERE booking_reference = $1', [bookingReference]);
}

async function availableRoomCountFor(checkIn: string, checkOut: string, adults = '2'): Promise<number> {
  const response = await getAvailability({ checkIn, checkOut, adults });
  const roomType = response.data.roomTypes.find((candidate) => candidate.slug === fixture.slug);

  assert.ok(roomType, `fixture room type ${fixture.slug} missing from availability response`);

  return roomType.availableRoomCount;
}

before(async () => {
  ({ getAvailability } = await import('../src/modules/availability/availability.service.js'));
  ({ createReservation, __setClientFactoryForTests } = await import(
    '../src/modules/reservations/reservations.service.js'
  ));
  ({ isNoAvailabilityError } = await import('../src/modules/reservations/reservations.types.js'));
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  const { rows: roomTypeRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO room_types (slug, name, capacity, base_nightly_rate, is_active, sort_order)
     VALUES ($1, $2, $3, $4, true, 0)
     RETURNING id`,
    [fixture.slug, fixture.name, fixture.capacity, fixture.baseNightlyRate],
  );

  const createdRoomType = roomTypeRows[0];
  assert.ok(createdRoomType, 'failed to create the fixture room type');
  roomTypeId = createdRoomType.id;

  const { rows: roomRows } = await dbPool.query<{ id: string }>(
    `INSERT INTO rooms (room_type_id, room_number, is_active)
     VALUES ($1, $2, true), ($1, $3, true)
     RETURNING id`,
    [roomTypeId, fixture.roomNumbers[0], fixture.roomNumbers[1]],
  );

  roomIds = roomRows.map((row) => row.id);
  assert.equal(roomIds.length, 2, 'expected exactly two fixture rooms');
});

after(async () => {
  try {
    // Every booking this suite makes now also queues a hotel notification.
    // Those rows hold no foreign key, so nothing would obstruct the deletes
    // below and nothing would ever clean them up either — they have to be
    // collected while the reservations that name them still exist.
    const { rows: booked } = await dbPool.query<{ booking_reference: string }>(
      'SELECT booking_reference FROM reservations WHERE room_type_id = $1',
      [roomTypeId],
    );
    const references = [...new Set([...booked.map((row) => row.booking_reference), ...outboxReferences])];

    await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference = ANY($1::text[])', [
      references,
    ]);

    // FK-safe order, scoped to this fixture only.
    await dbPool.query('DELETE FROM reservations WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM rooms WHERE room_type_id = $1', [roomTypeId]);
    await dbPool.query('DELETE FROM room_types WHERE id = $1', [roomTypeId]);

    const { rows } = await dbPool.query<{
      reservations: number;
      rooms: number;
      room_types: number;
      notifications: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM reservations WHERE room_type_id = $1)::int AS reservations,
              (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1)::int AS rooms,
              (SELECT COUNT(*) FROM room_types WHERE id = $1)::int AS room_types,
              (SELECT COUNT(*) FROM notification_outbox
                WHERE booking_reference = ANY($2::text[]))::int AS notifications`,
      [roomTypeId, references],
    );

    const remaining = rows[0];
    assert.ok(remaining, 'cleanup verification query returned no row');
    assert.deepEqual(
      remaining,
      { reservations: 0, rooms: 0, room_types: 0, notifications: 0 },
      `fixture ${fixture.slug} was not fully removed: ${JSON.stringify(remaining)}`,
    );
  } finally {
    await closeDatabasePool();
  }
});

describe('reservations integration', () => {
  it('reports both fixture rooms as available, priced from the room type rate', async () => {
    const response = await getAvailability({ checkIn: '2030-01-10', checkOut: '2030-01-12', adults: '2' });
    const roomType = response.data.roomTypes.find((candidate) => candidate.slug === fixture.slug);

    assert.ok(roomType, 'fixture room type missing from availability response');
    assert.equal(roomType.availableRoomCount, 2);
    assert.equal(roomType.baseNightlyRate, '1234.50');
    assert.equal(roomType.capacity, 2);
    assert.equal(response.data.nights, 2);
    // 1234.50 x 2 nights, exactly.
    assert.equal(roomType.totalAmount, '2469.00');
    assert.equal(roomType.currency, 'EGP');
  });

  it('excludes a room held by an overlapping pending reservation', async () => {
    const firstRoom = roomIds[0];
    assert.ok(firstRoom, 'fixture room id missing');

    const bookingReference = await insertDirectReservation({
      roomId: firstRoom,
      checkIn: '2030-01-10',
      checkOut: '2030-01-12',
      status: 'pending',
    });

    try {
      // Overlaps the blocking stay by one night.
      assert.equal(await availableRoomCountFor('2030-01-11', '2030-01-13'), 1);
    } finally {
      await deleteDirectReservation(bookingReference);
    }
  });

  it('allows same-day turnover, since stays are [checkIn, checkOut)', async () => {
    const firstRoom = roomIds[0];
    assert.ok(firstRoom, 'fixture room id missing');

    const bookingReference = await insertDirectReservation({
      roomId: firstRoom,
      checkIn: '2030-01-20',
      checkOut: '2030-01-22',
      status: 'pending',
    });

    try {
      // That stay ends on 2030-01-22, so a stay starting exactly that day does
      // not overlap it and both rooms are free.
      assert.equal(await availableRoomCountFor('2030-01-22', '2030-01-24'), 2);
    } finally {
      await deleteDirectReservation(bookingReference);
    }
  });

  it('ignores cancelled reservations when counting availability', async () => {
    const firstRoom = roomIds[0];
    assert.ok(firstRoom, 'fixture room id missing');

    const bookingReference = await insertDirectReservation({
      roomId: firstRoom,
      checkIn: '2030-02-01',
      checkOut: '2030-02-03',
      status: 'cancelled',
    });

    try {
      assert.equal(await availableRoomCountFor('2030-02-01', '2030-02-03'), 2);
    } finally {
      await deleteDirectReservation(bookingReference);
    }
  });

  it('creates a reservation and stores exactly what it reported', async () => {
    const created = await createReservation({
      roomTypeSlug: fixture.slug,
      checkIn: '2030-03-01',
      checkOut: '2030-03-04',
      adults: 2,
      children: 0,
      ...guest('Integration.Happy@Example.COM'),
      specialRequests: '  Integration verification  ',
    });

    assert.equal(created.status, 'pending');
    assert.equal(created.roomType.slug, fixture.slug);
    assert.equal(created.roomType.name, fixture.name);
    assert.equal(created.nights, 3);
    assert.equal(created.nightlyRate, '1234.50');
    // 1234.50 x 3 nights, exactly.
    assert.equal(created.totalAmount, '3703.50');
    assert.equal(created.currency, 'EGP');
    assert.match(created.bookingReference, /^TPH-[2-9A-HJ-NP-Z]{12}$/);

    const { rows } = await dbPool.query<{
      status: string;
      currency: string;
      nightly_rate_snapshot: string;
      total_amount: string;
      room_type_slug: string;
      has_room: boolean;
      check_in: string;
      check_out: string;
      guest_email: string;
      adults: number;
      children: number;
      special_requests: string | null;
    }>(
      `SELECT res.status,
              res.currency,
              res.nightly_rate_snapshot,
              res.total_amount,
              rt.slug AS room_type_slug,
              (res.room_id IS NOT NULL) AS has_room,
              res.check_in::text AS check_in,
              res.check_out::text AS check_out,
              res.guest_email,
              res.adults,
              res.children,
              res.special_requests
         FROM reservations res
         JOIN room_types rt ON rt.id = res.room_type_id
        WHERE res.booking_reference = $1`,
      [created.bookingReference],
    );

    const stored = rows[0];
    assert.ok(stored, 'reservation was reported as created but is not stored');
    assert.deepEqual(stored, {
      status: 'pending',
      currency: 'EGP',
      nightly_rate_snapshot: '1234.50',
      total_amount: '3703.50',
      room_type_slug: fixture.slug,
      has_room: true,
      check_in: '2030-03-01',
      check_out: '2030-03-04',
      guest_email: 'integration.happy@example.com',
      adults: 2,
      children: 0,
      special_requests: 'Integration verification',
    });

    // Leave the fixture clear for the concurrency scenario below. The
    // notification this booking queued outlives its reservation, so its
    // reference is remembered for cleanup.
    outboxReferences.push(created.bookingReference);
    await dbPool.query('DELETE FROM reservations WHERE booking_reference = $1', [created.bookingReference]);
  });

  it('lets exactly two of three concurrent requests take the two rooms', async () => {
    const checkIn = '2030-04-05';
    const checkOut = '2030-04-07';

    const results = await Promise.allSettled(
      [1, 2, 3].map((index) =>
        createReservation({
          roomTypeSlug: fixture.slug,
          checkIn,
          checkOut,
          adults: 2,
          children: 0,
          ...guest(`integration-concurrency-${index}@example.com`),
        }),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 2, 'expected exactly two reservations to succeed');
    assert.equal(rejected.length, 1, 'expected exactly one reservation to be refused');

    const refusal = rejected[0];
    assert.ok(refusal, 'expected a rejected result');
    assert.ok(
      isNoAvailabilityError(refusal.reason),
      `expected NoAvailabilityError, got: ${String(refusal.reason)}`,
    );

    const bookingReferences = fulfilled.map((result) => result.value.bookingReference);

    const { rows } = await dbPool.query<{
      stored_count: number;
      pending_count: number;
      fixture_count: number;
      date_match_count: number;
      distinct_rooms: number;
    }>(
      `SELECT COUNT(*)::int AS stored_count,
              (COUNT(*) FILTER (WHERE res.status = 'pending'))::int AS pending_count,
              (COUNT(*) FILTER (WHERE res.room_type_id = $2))::int AS fixture_count,
              (COUNT(*) FILTER (WHERE res.check_in::text = $3 AND res.check_out::text = $4))::int AS date_match_count,
              COUNT(DISTINCT res.room_id)::int AS distinct_rooms
         FROM reservations res
        WHERE res.booking_reference = ANY($1::text[])`,
      [bookingReferences, roomTypeId, checkIn, checkOut],
    );

    const verification = rows[0];
    assert.ok(verification, 'verification query returned no row');
    assert.deepEqual(verification, {
      stored_count: 2,
      pending_count: 2,
      fixture_count: 2,
      date_match_count: 2,
      // Each winner holds a different physical room.
      distinct_rooms: 2,
    });

    // Both rooms are now taken for this stay.
    assert.equal(await availableRoomCountFor(checkIn, checkOut), 0);
  });

  // The two claims about the hotel notification that only a real database can
  // settle: that the booking and its event become durable together, and that
  // when the event cannot be written the booking does not survive either.
  // Everything about ordering and error handling is proved against a double in
  // `reservations.notification.test.ts` and is not repeated here.

  it('commits the booking and its hotel notification together', async () => {
    const checkIn = '2030-05-02';
    const checkOut = '2030-05-04';

    const created = await createReservation({
      roomTypeSlug: fixture.slug,
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      specialRequests: 'Integration outbox check',
      ...guest('integration.outbox@example.com'),
    });

    const { rows } = await dbPool.query<{
      event_type: string;
      recipient_kind: string;
      recipient_email: string | null;
      template_key: string;
      attempts: number;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, recipient_kind, recipient_email, template_key, attempts, payload
         FROM notification_outbox
        WHERE booking_reference = $1`,
      [created.bookingReference],
    );

    assert.equal(rows.length, 1, 'exactly one event for the committed booking');

    const event = rows[0];
    assert.ok(event, 'the event row is readable after COMMIT');
    assert.equal(event.event_type, 'room_reservation_created');
    assert.equal(event.recipient_kind, 'hotel');
    assert.equal(event.recipient_email, null);
    assert.equal(event.template_key, 'room_created_hotel.v1');
    assert.equal(event.attempts, 0, 'queued, not attempted');

    // The stored payload agrees with what the guest was told.
    assert.equal(event.payload.bookingReference, created.bookingReference);
    assert.equal(event.payload.roomTypeName, fixture.name);
    assert.equal(event.payload.totalAmount, created.totalAmount);
    assert.equal(event.payload.nightlyRate, created.nightlyRate);
    assert.equal(event.payload.guestEmail, 'integration.outbox@example.com');

    outboxReferences.push(created.bookingReference);
    await dbPool.query('DELETE FROM notification_outbox WHERE booking_reference = $1', [
      created.bookingReference,
    ]);
    await dbPool.query('DELETE FROM reservations WHERE booking_reference = $1', [
      created.bookingReference,
    ]);
  });

  it('leaves no reservation behind when the outbox insert fails', async () => {
    // A real connection, real SQL and a real transaction — only the one
    // notification INSERT is made to fail, which is the one thing a healthy
    // PostgreSQL will not do on request. A double cannot prove this: the
    // question is whether the ROLLBACK actually discarded a row the database
    // had already written, and that can only be asked of the database.
    const checkIn = '2030-05-10';
    const checkOut = '2030-05-12';
    const failure = Object.assign(new Error('simulated outbox failure'), { code: '23505' });

    const client = await dbPool.connect();
    const realQuery = client.query.bind(client);
    let outboxAttempts = 0;

    Object.assign(client, {
      query(text: unknown, ...rest: unknown[]) {
        if (typeof text === 'string' && text.includes('INSERT INTO notification_outbox')) {
          outboxAttempts += 1;
          return Promise.reject(failure);
        }
        return (realQuery as (...args: unknown[]) => unknown)(text, ...rest);
      },
    });

    __setClientFactoryForTests(async () => client);

    try {
      const thrown = await createReservation({
        roomTypeSlug: fixture.slug,
        checkIn,
        checkOut,
        adults: 2,
        children: 0,
        ...guest('integration.outbox-failure@example.com'),
      }).then(
        () => null,
        (error: unknown) => error,
      );

      assert.equal(thrown, failure, 'the original error reached the caller');
      assert.equal(outboxAttempts, 1, 'no retry');
    } finally {
      __setClientFactoryForTests(null);

      // Not released here. Handing this client to the service through the
      // factory handed over ownership with it: `createReservation` releases the
      // client it acquires, in its own `finally`, and by the time this block
      // runs it already has. A second release would return the same connection
      // to the pool twice.
      //
      // The interception does have to be undone. The object is back in the pool
      // now and will be handed to somebody else, so leaving an own `query` that
      // rejects every outbox insert would sabotage whichever later test
      // happened to be given this connection. Deleting the property restores
      // the prototype's real method rather than layering another wrapper.
      delete (client as unknown as { query?: unknown }).query;
    }

    // Asked on a different connection, so it can only see committed data.
    const { rows } = await dbPool.query<{ reservations: number; notifications: number }>(
      `SELECT (SELECT COUNT(*) FROM reservations
                WHERE room_type_id = $1 AND check_in::text = $2)::int AS reservations,
              (SELECT COUNT(*) FROM notification_outbox
                WHERE payload ->> 'guestEmail' = $3)::int AS notifications`,
      [roomTypeId, checkIn, 'integration.outbox-failure@example.com'],
    );

    assert.deepEqual(
      rows[0],
      { reservations: 0, notifications: 0 },
      'the reservation rolled back with the notification it could not queue',
    );

    // And the rooms are free again, which is the guest-visible consequence.
    assert.equal(await availableRoomCountFor(checkIn, checkOut), 2);
  });
});
