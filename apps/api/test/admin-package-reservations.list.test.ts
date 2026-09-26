import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// The admin package reservation list, without a database.
//
// The route's guard is exercised for real: `requireAdminSession` answers 401
// on a request with no session cookie before it ever reaches the database, so
// the rejection this endpoint depends on is provable here rather than only in
// an integration run.

type RepositoryModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.repository.js');
type ControllerModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.controller.js');
type RoutesModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.routes.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let listAdminPackageReservationsHandler: ControllerModule['listAdminPackageReservationsHandler'];
let adminPackageReservationsRouter: RoutesModule['adminPackageReservationsRouter'];

before(async () => {
  // The module graph reaches db/pool, which requires DATABASE_URL at import
  // time. Nothing here connects or queries, so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.repository.js'
  ));
  ({ listAdminPackageReservationsHandler } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.controller.js'
  ));
  ({ adminPackageReservationsRouter } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.routes.js'
  ));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** One stored row, so each test varies only what it cares about. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    booking_reference: 'TPP-23456789ABCD',
    package_code_snapshot: 'T001',
    package_slug: 'tour-to-giza-pyramids-and-sphinx',
    package_title_snapshot: 'Tour to Giza Pyramids and Sphinx',
    variant_key: 'standard',
    variant_label_snapshot: 'Standard',
    guest_first_name: 'Amira',
    guest_last_name: 'Hassan',
    guest_email: 'amira@example.test',
    guest_phone: '+201000000000',
    tour_date: '2026-10-01',
    adults: 2,
    children: 0,
    status: 'pending',
    pricing_status: 'quoted',
    currency: 'USD',
    total_amount_snapshot: '200.00',
    created_at: new Date('2026-09-20T18:45:22.411Z'),
    ...overrides,
  };
}

type RecordedQuery = { text: string; values: unknown[] | undefined };

function fakeQueryable(rows: unknown[]): RecordedQuery[] {
  const calls: RecordedQuery[] = [];

  __setQueryableForTests({
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows } as never;
    },
  } as never);

  return calls;
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

function reservationsOf(captured: Captured): Array<Record<string, unknown>> {
  return (captured.body as { data: { reservations: Array<Record<string, unknown>> } }).data
    .reservations;
}

async function listWith(rows: unknown[]): Promise<Captured> {
  fakeQueryable(rows);
  const { res, captured } = fakeResponse();
  await listAdminPackageReservationsHandler({} as Request, res);
  return captured;
}

describe('admin package reservation list: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    // Taken from the router itself, so this is the guard actually mounted on
    // the route rather than one the test chose to run.
    const layer = (adminPackageReservationsRouter as never as {
      stack: Array<{ route?: { path: string; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/');

    assert.ok(layer?.route, 'GET / should be registered');
    const chain = layer.route.stack;

    assert.equal(chain[0].name, 'requireAdminSession', 'the guard must come first in the chain');
    assert.equal(chain.length, 2, 'the chain should be guard + handler and nothing else');

    // No cookie header at all: the guard answers without a session lookup, so
    // no database is required to prove the rejection.
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
    assert.deepEqual(Object.keys(captured.body as object), ['error']);
  });
});

describe('admin package reservation list: reading', () => {
  it('returns reservations for an authenticated request', async () => {
    const captured = await listWith([row()]);

    assert.equal(captured.status, 200);
    const [reservation] = reservationsOf(captured);
    assert.equal(reservation.bookingReference, 'TPP-23456789ABCD');
    assert.deepEqual(reservation.package, {
      code: 'T001',
      slug: 'tour-to-giza-pyramids-and-sphinx',
      title: 'Tour to Giza Pyramids and Sphinx',
    });
    assert.deepEqual(reservation.variant, { key: 'standard', label: 'Standard' });
    assert.equal(reservation.guestName, 'Amira Hassan');
    assert.equal(reservation.guestEmail, 'amira@example.test');
    assert.equal(reservation.guestPhone, '+201000000000');
    assert.equal(reservation.tourDate, '2026-10-01');
    assert.equal(reservation.adults, 2);
    assert.equal(reservation.children, 0);
    assert.equal(reservation.status, 'pending');
    assert.equal(reservation.pricingStatus, 'quoted');
    assert.equal(reservation.currency, 'USD');
    assert.equal(reservation.createdAt, '2026-09-20T18:45:22.411Z');
  });

  it('returns a successful empty array when there are no reservations', async () => {
    const captured = await listWith([]);

    assert.equal(captured.status, 200);
    assert.deepEqual(captured.body, { data: { reservations: [] } });
  });

  it('orders deterministically, newest first, with id breaking ties', async () => {
    const calls = fakeQueryable([]);
    const { res } = fakeResponse();
    await listAdminPackageReservationsHandler({} as Request, res);

    assert.equal(calls.length, 1, 'the list should cost one query');
    assert.match(calls[0].text, /ORDER BY pr\.created_at DESC, pr\.id DESC/);
  });

  it('preserves the order the database returned, without re-sorting in code', async () => {
    const captured = await listWith([
      row({ booking_reference: 'TPP-NEWEST0000A', created_at: new Date('2026-09-22T10:00:00.000Z') }),
      row({ booking_reference: 'TPP-MIDDLE0000B', created_at: new Date('2026-09-21T10:00:00.000Z') }),
      row({ booking_reference: 'TPP-OLDEST0000C', created_at: new Date('2026-09-20T10:00:00.000Z') }),
    ]);

    assert.deepEqual(
      reservationsOf(captured).map((reservation) => reservation.bookingReference),
      ['TPP-NEWEST0000A', 'TPP-MIDDLE0000B', 'TPP-OLDEST0000C'],
    );
  });

  it('keeps a manual-confirmation reservation\'s total as null', async () => {
    const captured = await listWith([
      row({ pricing_status: 'requires_confirmation', total_amount_snapshot: null }),
    ]);

    const [reservation] = reservationsOf(captured);
    assert.equal(reservation.pricingStatus, 'requires_confirmation');
    assert.equal(reservation.totalAmountSnapshot, null, 'never 0, never an empty string');
    assert.ok('totalAmountSnapshot' in reservation, 'the key must still be present');
  });

  it('passes a quoted total through as the exact stored string', async () => {
    const captured = await listWith([row({ total_amount_snapshot: '3750.50' })]);

    // Money is never turned into a JavaScript number on the way out.
    assert.equal(reservationsOf(captured)[0].totalAmountSnapshot, '3750.50');
  });

  it('exposes no internal database ids', async () => {
    const captured = await listWith([
      // Ids the query does not select, offered anyway: nothing may carry them
      // through just because the row happened to have them.
      row({ id: '42', package_id: '7', variant_id: '9' }),
    ]);

    const [reservation] = reservationsOf(captured);

    assert.deepEqual(Object.keys(reservation).sort(), [
      'adults',
      'bookingReference',
      'children',
      'createdAt',
      'currency',
      'guestEmail',
      'guestName',
      'guestPhone',
      'package',
      'pricingStatus',
      'status',
      'totalAmountSnapshot',
      'tourDate',
      'variant',
    ]);
    assert.deepEqual(Object.keys(reservation.package as object).sort(), ['code', 'slug', 'title']);
    assert.deepEqual(Object.keys(reservation.variant as object).sort(), ['key', 'label']);

    // Named explicitly as well, and checked against the whole serialized body
    // so a nested id could not hide from the key assertions above.
    const serialized = JSON.stringify(captured.body);
    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });

  it('keeps detail-only stored fields out of the list', async () => {
    const captured = await listWith([
      row({
        child_ages: [7, 9],
        special_requests: 'Window seat',
        adult_unit_rate_snapshot: '100.00',
        child_unit_rate_snapshot: '50.00',
        guest_country: 'Egypt',
      }),
    ]);

    const [reservation] = reservationsOf(captured);
    for (const field of [
      'childAges',
      'specialRequests',
      'adultUnitRateSnapshot',
      'childUnitRateSnapshot',
      'guestCountry',
    ]) {
      assert.equal(reservation[field], undefined, `${field} belongs to a detail view, not the list`);
    }
  });
});

describe('admin package reservation list: refusing impossible stored data', () => {
  it('raises rather than reporting a status, pricing status or currency it does not know', async () => {
    for (const [override, expected] of [
      [{ status: 'refunded' }, /status/],
      [{ pricing_status: 'estimated' }, /pricing status/],
      [{ currency: 'EGP' }, /currency/],
      [{ created_at: new Date('nope') }, /created_at/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      fakeQueryable([row(override)]);
      const { res } = fakeResponse();
      await assert.rejects(listAdminPackageReservationsHandler({} as Request, res), expected);
    }
  });

  it('raises when a stored row contradicts the schema\'s pricing rule', async () => {
    // Both directions of the CHECK the migration already enforces.
    fakeQueryable([row({ pricing_status: 'requires_confirmation', total_amount_snapshot: '10.00' })]);
    const first = fakeResponse();
    await assert.rejects(
      listAdminPackageReservationsHandler({} as Request, first.res),
      /confirmation-required rows carry no total/,
    );

    fakeQueryable([row({ pricing_status: 'quoted', total_amount_snapshot: null })]);
    const second = fakeResponse();
    await assert.rejects(
      listAdminPackageReservationsHandler({} as Request, second.res),
      /quoted row must carry one/,
    );
  });
});
