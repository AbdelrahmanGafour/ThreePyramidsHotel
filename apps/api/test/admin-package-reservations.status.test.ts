import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// The admin package reservation status transition, without a database.
//
// The concurrency guarantee is modelled rather than mocked away: the fake
// below holds one row's status behind an exclusive lock taken by the
// `SELECT ... FOR UPDATE` and released at COMMIT/ROLLBACK, which is what InnoDB
// does. The second transition therefore reads the committed status and is
// refused for the same reason it is in the database.

type RepositoryModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.repository.js');
type ControllerModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.controller.js');
type RoutesModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.routes.js');
type StatusModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.status.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let updateAdminPackageReservationStatusHandler: ControllerModule['updateAdminPackageReservationStatusHandler'];
let adminPackageReservationsRouter: RoutesModule['adminPackageReservationsRouter'];
let isAdminPackageReservationStatusTransitionAllowed: StatusModule['isAdminPackageReservationStatusTransitionAllowed'];

const REFERENCE = 'TPP-23456789ABCD';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.repository.js'
  ));
  ({ updateAdminPackageReservationStatusHandler } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.controller.js'
  ));
  ({ adminPackageReservationsRouter } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.routes.js'
  ));
  ({ isAdminPackageReservationStatusTransitionAllowed } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.status.js'
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
    guest_email: 'amira@example.test',
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

/**
 * One stored reservation behind a transactional fake. The `FOR UPDATE` read
 * takes a row lock that is held until COMMIT or ROLLBACK, so a second
 * transition waits and then sees the committed status, exactly as InnoDB
 * does. The update then applies only if the status read under that lock is in
 * the allowed set.
 */
function storedReservation(initialStatus: string | null) {
  const state = {
    status: initialStatus,
    updates: 0,
    outbox: 0,
    committed: 0,
    rolledBack: 0,
    calls: [] as Recorded[],
  };
  let tail: Promise<void> = Promise.resolve();

  const connect = async () => {
    let unlock: (() => void) | null = null;

    return {
      async query(text: string, values?: unknown[]) {
        state.calls.push({ text, values });
        const compact = text.replace(/\s+/g, ' ').trim();

        if (compact === 'BEGIN') return { rows: [], rowCount: 0 } as never;

        if (compact === 'COMMIT' || compact === 'ROLLBACK') {
          if (compact === 'COMMIT') state.committed += 1;
          else state.rolledBack += 1;
          unlock?.();
          unlock = null;
          return { rows: [], rowCount: 0 } as never;
        }

        if (compact.includes('FOR UPDATE OF u')) {
          const previous = tail;
          let release!: () => void;
          tail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          unlock = release;
          return { rows: state.status === null ? [] : [row(state.status)] } as never;
        }

        if (compact.includes('UPDATE package_reservations')) {
          state.status = values?.[1] as string;
          state.updates += 1;
          return { rows: [], rowCount: 1 } as never;
        }

        if (compact.includes('INSERT INTO notification_outbox')) {
          state.outbox += 1;
          return { rows: [], rowCount: 1 } as never;
        }

        throw new Error(`unexpected statement: ${compact}`);
      },
      release() {
        unlock?.();
        unlock = null;
      },
    };
  };

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      state.calls.push({ text, values });
      return { rows: [] } as never;
    },
    connect,
  } as never);

  return state;
}

type Captured = { status: number | undefined; body: unknown };

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { status: undefined, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
}

function patch(bookingReference: string, body: unknown): Request<{ bookingReference: string }> {
  return { params: { bookingReference }, body } as unknown as Request<{ bookingReference: string }>;
}

async function transition(
  bookingReference: string,
  body: unknown,
): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await updateAdminPackageReservationStatusHandler(patch(bookingReference, body), res);
  return captured;
}

function dataOf(captured: Captured): Record<string, unknown> {
  return (captured.body as { data: Record<string, unknown> }).data;
}

const CONFLICT_BODY = {
  error: {
    code: 'INVALID_PACKAGE_RESERVATION_STATUS_TRANSITION',
    message: 'Package reservation status transition is not allowed',
  },
};

const INVALID_STATUS_BODY = {
  error: { code: 'INVALID_PACKAGE_RESERVATION_STATUS', message: 'Invalid package reservation status' },
};

describe('admin package reservation status: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackageReservationsRouter as never as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:bookingReference/status');

    assert.ok(layer?.route, 'PATCH /:bookingReference/status should be registered');
    assert.equal(layer.route.methods.patch, true, 'it should be a PATCH route');

    const chain = layer.route.stack;
    assert.equal(chain[0].name, 'requireAdminSession', 'the guard must come first in the chain');
    assert.equal(chain.length, 2, 'the chain should be guard + handler and nothing else');

    const guard = chain[0].handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;
    const { res, captured } = fakeResponse();
    let nextCalls = 0;

    await guard({ headers: {} } as Request, res, () => {
      nextCalls += 1;
    });

    assert.equal(captured.status, 401);
    assert.equal(nextCalls, 0, 'the handler must never run for an unauthenticated request');
  });
});

describe('admin package reservation status: allowed transitions', () => {
  it('moves a pending reservation to confirmed', async () => {
    const stored = storedReservation('pending');
    const captured = await transition(REFERENCE, { status: 'confirmed' });

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).status, 'confirmed');
    assert.equal(stored.status, 'confirmed');
    assert.equal(stored.updates, 1);
  });

  it('moves a pending reservation to cancelled', async () => {
    const stored = storedReservation('pending');
    const captured = await transition(REFERENCE, { status: 'cancelled' });

    assert.equal(captured.status, 200);
    assert.equal(dataOf(captured).status, 'cancelled');
    assert.equal(stored.status, 'cancelled');
  });

  it('states the rule in exactly one place', () => {
    assert.equal(isAdminPackageReservationStatusTransitionAllowed('pending', 'confirmed'), true);
    assert.equal(isAdminPackageReservationStatusTransitionAllowed('pending', 'cancelled'), true);
    // Stricter than the room rule on purpose: a confirmed package holds no
    // inventory to release, and unwinding one is not this endpoint's job.
    assert.equal(isAdminPackageReservationStatusTransitionAllowed('confirmed', 'cancelled'), false);
    assert.equal(isAdminPackageReservationStatusTransitionAllowed('confirmed', 'confirmed'), false);
    assert.equal(isAdminPackageReservationStatusTransitionAllowed('cancelled', 'confirmed'), false);
    assert.equal(isAdminPackageReservationStatusTransitionAllowed('cancelled', 'cancelled'), false);
  });
});

describe('admin package reservation status: refused transitions', () => {
  it('refuses every move out of a terminal state with 409', async () => {
    for (const from of ['confirmed', 'cancelled']) {
      for (const to of ['confirmed', 'cancelled']) {
        const stored = storedReservation(from);
        const captured = await transition(REFERENCE, { status: to });

        assert.equal(captured.status, 409, `${from} -> ${to} should conflict`);
        assert.deepEqual(captured.body, CONFLICT_BODY);
        assert.equal(stored.status, from, 'the stored status must be untouched');
        assert.equal(stored.updates, 0);
      }
    }
  });

  it('refuses a self-transition', async () => {
    // pending -> pending is refused as input: `pending` is not a target a
    // request may name, so it never reaches the reservation.
    const stored = storedReservation('pending');
    const captured = await transition(REFERENCE, { status: 'pending' });

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, INVALID_STATUS_BODY);
    assert.equal(stored.calls.length, 0, 'it must not reach the database');

    // confirmed -> confirmed is refused by the transition rule itself.
    const confirmed = storedReservation('confirmed');
    const conflict = await transition(REFERENCE, { status: 'confirmed' });
    assert.equal(conflict.status, 409);
    assert.equal(confirmed.updates, 0);
  });
});

describe('admin package reservation status: concurrency', () => {
  it('lets only one of two concurrent transitions succeed', async () => {
    const stored = storedReservation('pending');

    const [first, second] = await Promise.all([
      transition(REFERENCE, { status: 'confirmed' }),
      transition(REFERENCE, { status: 'cancelled' }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one must win');
    assert.equal(stored.updates, 1, 'the row must be written exactly once');
    assert.ok(['confirmed', 'cancelled'].includes(stored.status as string));
  });

  it('cannot overwrite a terminal state with a stale transition', async () => {
    const stored = storedReservation('pending');

    const won = await transition(REFERENCE, { status: 'cancelled' });
    assert.equal(won.status, 200);

    // A second administrator acting on a page rendered before the cancel.
    const stale = await transition(REFERENCE, { status: 'confirmed' });

    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, CONFLICT_BODY);
    assert.equal(stored.status, 'cancelled', 'the terminal state stands');
    assert.equal(stored.updates, 1);
  });

  it('decides under a row lock, then writes, in one transaction', async () => {
    const stored = storedReservation('pending');
    await transition(REFERENCE, { status: 'confirmed' });

    const texts = stored.calls.map((call) => call.text.replace(/\s+/g, ' ').trim());
    assert.equal(texts[0], 'BEGIN');
    assert.match(texts[1], /FOR UPDATE OF u$/);
    assert.match(texts[2], /^UPDATE package_reservations/);
    assert.match(texts[3], /^INSERT INTO notification_outbox/);
    assert.equal(texts[4], 'COMMIT');
    assert.equal(texts.length, 5);
    assert.equal(stored.committed, 1);
  });

  it('writes only status and updated_at, never a snapshot', async () => {
    const stored = storedReservation('pending');
    await transition(REFERENCE, { status: 'confirmed' });

    const update = stored.calls.find((call) => call.text.includes('UPDATE package_reservations'));
    assert.ok(update);
    const setClause = update.text.split('SET')[1].split('WHERE')[0];
    assert.match(setClause, /status = \$2/);
    assert.match(setClause, /updated_at = UTC_TIMESTAMP\(3\)/);

    for (const column of [
      'package_code_snapshot',
      'package_title_snapshot',
      'variant_label_snapshot',
      'adult_unit_rate_snapshot',
      'child_unit_rate_snapshot',
      'total_amount_snapshot',
      'pricing_status',
      'currency',
      'adults',
      'children',
    ]) {
      assert.ok(!setClause.includes(column), `${column} must never be written by this endpoint`);
    }
  });
});

describe('admin package reservation status: validation and not found', () => {
  it('rejects an invalid status or body with 400, without querying', async () => {
    for (const body of [
      { status: 'pending' },
      { status: 'refunded' },
      { status: 'CONFIRMED' },
      { status: ' confirmed ' },
      { status: 1 },
      { status: null },
      {},
      null,
      [],
      'confirmed',
      undefined,
    ]) {
      const stored = storedReservation('pending');
      const captured = await transition(REFERENCE, body);

      assert.equal(captured.status, 400, `${JSON.stringify(body ?? null)} should be refused`);
      assert.deepEqual(captured.body, INVALID_STATUS_BODY);
      assert.equal(stored.calls.length, 0, 'an invalid body must never reach the database');
    }
  });

  it('rejects a malformed booking reference before the body or any query', async () => {
    const stored = storedReservation('pending');
    // Both malformed: the reference wins, so the answer is the same every time.
    const captured = await transition('nope', { status: 'refunded' });

    assert.equal(captured.status, 400);
    assert.deepEqual(captured.body, {
      error: {
        code: 'INVALID_PACKAGE_BOOKING_REFERENCE',
        message: 'Invalid package booking reference',
      },
    });
    assert.equal(stored.calls.length, 0);
  });

  it('answers 404 for a well-formed reference nobody booked', async () => {
    storedReservation(null);
    const captured = await transition(REFERENCE, { status: 'confirmed' });

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_RESERVATION_NOT_FOUND', message: 'Package reservation not found' },
    });
  });

  it('keeps 400, 404 and 409 clearly apart', async () => {
    storedReservation('pending');
    const badBody = await transition(REFERENCE, { status: 'nope' });
    storedReservation(null);
    const missing = await transition(REFERENCE, { status: 'confirmed' });
    storedReservation('cancelled');
    const conflict = await transition(REFERENCE, { status: 'confirmed' });

    assert.deepEqual([badBody.status, missing.status, conflict.status], [400, 404, 409]);
  });
});

describe('admin package reservation status: response', () => {
  it('returns the updated detail with every snapshot unchanged', async () => {
    storedReservation('pending');
    const detail = dataOf(await transition(REFERENCE, { status: 'confirmed' }));

    assert.equal(detail.status, 'confirmed');
    // Everything else is exactly what it was before the transition.
    assert.deepEqual(detail.package, {
      code: 'T016',
      slug: 'nile-dinner-cruise',
      title: 'Nile Dinner Cruise',
    });
    assert.deepEqual(detail.variant, { key: 'premium-service', label: 'Premium service' });
    assert.equal(detail.adultUnitRateSnapshot, '100.00');
    assert.equal(detail.childUnitRateSnapshot, '50.00');
    assert.equal(detail.totalAmountSnapshot, '300.00');
    assert.equal(detail.pricingStatus, 'quoted');
    assert.equal(detail.currency, 'USD');
    assert.deepEqual(detail.childAges, [7, 9]);
    assert.equal(detail.specialRequests, 'Window table if possible');
    assert.equal(detail.createdAt, '2026-09-20T18:45:22.411Z');
  });

  it('returns the same safe shape as the detail endpoint, with no database ids', async () => {
    storedReservation('pending');
    const captured = await transition(REFERENCE, { status: 'cancelled' });

    assert.deepEqual(Object.keys(dataOf(captured)).sort(), [
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

    const serialized = JSON.stringify(captured.body);
    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });
});
