import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, before, describe, it } from 'node:test';

// The admin package reservation detail endpoint, without a database.
//
// The route's guard is exercised for real: `requireAdminSession` answers 401
// on a request with no session cookie before it ever reaches the database.

type RepositoryModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.repository.js');
type ControllerModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.controller.js');
type RoutesModule = typeof import('../src/modules/admin-package-reservations/admin-package-reservations.routes.js');

let __setQueryableForTests: RepositoryModule['__setQueryableForTests'];
let getAdminPackageReservationHandler: ControllerModule['getAdminPackageReservationHandler'];
let adminPackageReservationsRouter: RoutesModule['adminPackageReservationsRouter'];

const REFERENCE = 'TPP-23456789ABCD';

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setQueryableForTests } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.repository.js'
  ));
  ({ getAdminPackageReservationHandler } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.controller.js'
  ));
  ({ adminPackageReservationsRouter } = await import(
    '../src/modules/admin-package-reservations/admin-package-reservations.routes.js'
  ));
});

afterEach(() => {
  __setQueryableForTests(null);
});

/** One stored detail row, so each test varies only what it cares about. */
function row(overrides: Record<string, unknown> = {}) {
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
    status: 'pending',
    pricing_status: 'quoted',
    currency: 'USD',
    adult_unit_rate_snapshot: '100.00',
    child_unit_rate_snapshot: '50.00',
    total_amount_snapshot: '300.00',
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

function request(bookingReference: string): Request<{ bookingReference: string }> {
  return { params: { bookingReference } } as unknown as Request<{ bookingReference: string }>;
}

async function detailOf(rows: unknown[], reference = REFERENCE): Promise<Captured> {
  fakeQueryable(rows);
  const { res, captured } = fakeResponse();
  await getAdminPackageReservationHandler(request(reference), res);
  return captured;
}

function dataOf(captured: Captured): Record<string, unknown> {
  return (captured.body as { data: Record<string, unknown> }).data;
}

describe('admin package reservation detail: authentication', () => {
  it('rejects an unauthenticated request with 401 before touching the database', async () => {
    const layer = (adminPackageReservationsRouter as never as {
      stack: Array<{ route?: { path: string; stack: Array<{ name: string; handle: unknown }> } }>;
    }).stack.find((entry) => entry.route?.path === '/:bookingReference');

    assert.ok(layer?.route, 'GET /:bookingReference should be registered');
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

describe('admin package reservation detail: reading', () => {
  it('returns the full reservation for an existing reference', async () => {
    const captured = await detailOf([row()]);

    assert.equal(captured.status, 200);
    assert.deepEqual(dataOf(captured), {
      bookingReference: REFERENCE,
      package: { code: 'T016', slug: 'nile-dinner-cruise', title: 'Nile Dinner Cruise' },
      variant: { key: 'premium-service', label: 'Premium service' },
      guestName: 'Amira Hassan',
      guestEmail: 'amira@example.test',
      guestPhone: '+201000000000',
      guestCountry: 'Egypt',
      tourDate: '2026-10-01',
      adults: 2,
      children: 2,
      childAges: [7, 9],
      specialRequests: 'Window table if possible',
      status: 'pending',
      pricingStatus: 'quoted',
      currency: 'USD',
      adultUnitRateSnapshot: '100.00',
      childUnitRateSnapshot: '50.00',
      totalAmountSnapshot: '300.00',
      createdAt: '2026-09-20T18:45:22.411Z',
    });
  });

  it('carries every field the list carries', async () => {
    // Proved against the list's own contract rather than a copied list, so
    // the two cannot drift apart unnoticed.
    const { toAdminPackageReservationListItem } = await import(
      '../src/modules/admin-package-reservations/admin-package-reservations.repository.js'
    );
    const listItem = toAdminPackageReservationListItem(row() as never);
    const detail = dataOf(await detailOf([row()]));

    for (const [field, value] of Object.entries(listItem)) {
      assert.deepEqual(detail[field], value, `${field} should match the list contract exactly`);
    }
  });

  it('looks the reservation up by reference, as a bound parameter', async () => {
    const calls = fakeQueryable([row()]);
    const { res } = fakeResponse();
    await getAdminPackageReservationHandler(request(REFERENCE), res);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].values, [REFERENCE]);
    assert.match(calls[0].text, /WHERE pr\.booking_reference = \$1/);
    // Never looked up by an internal id.
    assert.ok(!calls[0].text.includes('pr.id ='), 'lookup must not be by internal id');
  });

  it('returns the stored snapshots, not live catalogue values', async () => {
    const calls = fakeQueryable([row()]);
    const { res, captured } = fakeResponse();
    await getAdminPackageReservationHandler(request(REFERENCE), res);

    // The booked facts come from the reservation's own snapshot columns.
    for (const column of [
      'pr.package_code_snapshot',
      'pr.package_title_snapshot',
      'pr.variant_label_snapshot',
      'pr.adult_unit_rate_snapshot',
      'pr.child_unit_rate_snapshot',
      'pr.total_amount_snapshot',
    ]) {
      assert.ok(calls[0].text.includes(column), `${column} must be read from the reservation`);
    }
    // The live catalogue supplies only the two addresses, never a price or title.
    assert.ok(!/p\.title/.test(calls[0].text), 'the live package title must not be read');
    assert.ok(!/adult_unit_rate\b(?!_snapshot)/.test(calls[0].text), 'live rates must not be read');

    const detail = dataOf(captured);
    assert.equal(detail.adultUnitRateSnapshot, '100.00');
    assert.equal(detail.childUnitRateSnapshot, '50.00');
    assert.equal(detail.totalAmountSnapshot, '300.00');
  });

  it('keeps money as exact strings, never numbers', async () => {
    const detail = dataOf(await detailOf([row({ adult_unit_rate_snapshot: '999.99', total_amount_snapshot: '2999.97', children: 0, child_ages: null, child_unit_rate_snapshot: null, adults: 3 })]));

    assert.equal(typeof detail.adultUnitRateSnapshot, 'string');
    assert.equal(detail.adultUnitRateSnapshot, '999.99');
    assert.equal(detail.totalAmountSnapshot, '2999.97');
  });
});

describe('admin package reservation detail: nullable fields', () => {
  it('preserves every nullable detail field as null', async () => {
    const detail = dataOf(
      await detailOf([
        row({
          children: 0,
          child_ages: null,
          child_unit_rate_snapshot: null,
          special_requests: null,
          total_amount_snapshot: '200.00',
        }),
      ]),
    );

    assert.equal(detail.childAges, null, 'null is not []');
    assert.equal(detail.childUnitRateSnapshot, null);
    assert.equal(detail.specialRequests, null);
    for (const field of ['childAges', 'childUnitRateSnapshot', 'specialRequests']) {
      assert.ok(field in detail, `${field} must still be present as a key`);
    }
  });

  it('preserves a confirmation-required reservation\'s null total', async () => {
    const detail = dataOf(
      await detailOf([
        row({
          pricing_status: 'requires_confirmation',
          total_amount_snapshot: null,
          child_unit_rate_snapshot: null,
          children: 0,
          child_ages: null,
        }),
      ]),
    );

    assert.equal(detail.pricingStatus, 'requires_confirmation');
    assert.equal(detail.totalAmountSnapshot, null, 'never 0, never an empty string');
    assert.ok('totalAmountSnapshot' in detail);
  });

  it('refuses stored child ages that contradict the schema', async () => {
    for (const [override, expected] of [
      [{ child_ages: [7], children: 2 }, /count mismatch/],
      [{ child_ages: [7, -1] }, /invalid age/],
      [{ child_ages: [7, 9.5] }, /invalid age/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      fakeQueryable([row(override)]);
      const { res } = fakeResponse();
      await assert.rejects(getAdminPackageReservationHandler(request(REFERENCE), res), expected);
    }
  });
});

describe('admin package reservation detail: not found and validation', () => {
  it('answers 404 for a well-formed reference nobody booked', async () => {
    const captured = await detailOf([]);

    assert.equal(captured.status, 404);
    assert.deepEqual(captured.body, {
      error: { code: 'PACKAGE_RESERVATION_NOT_FOUND', message: 'Package reservation not found' },
    });
  });

  it('answers 400 for a malformed reference, without querying at all', async () => {
    for (const malformed of [
      'nope',
      'TPP-',
      'TPP-23456789ABC',        // one short
      'TPP-23456789ABCDE',      // one long
      'TPP-23456789ABC0',       // 0 is not in the alphabet
      'TPP-23456789ABCI',       // I is not in the alphabet
      'tpp-23456789abcd',       // lowercase is not normalised into a match
      ' TPP-23456789ABCD',
      'TPP-23456789ABCD\n',
    ]) {
      const calls = fakeQueryable([row()]);
      const { res, captured } = fakeResponse();
      await getAdminPackageReservationHandler(request(malformed), res);

      assert.equal(captured.status, 400, `${JSON.stringify(malformed)} should be refused`);
      assert.deepEqual(captured.body, {
        error: {
          code: 'INVALID_PACKAGE_BOOKING_REFERENCE',
          message: 'Invalid package booking reference',
        },
      });
      assert.equal(calls.length, 0, 'a malformed reference must never reach the database');
    }
  });

  it('keeps a malformed reference and an unknown one clearly apart', async () => {
    const malformed = await detailOf([row()], 'nope');
    const unknown = await detailOf([]);

    assert.equal(malformed.status, 400);
    assert.equal(unknown.status, 404);
    assert.notDeepEqual(malformed.body, unknown.body);
  });

  it('never echoes the supplied reference back in an error', async () => {
    const captured = await detailOf([row()], 'TPP-SECRETVALUE0');

    assert.ok(!JSON.stringify(captured.body).includes('SECRETVALUE'));
  });
});

describe('admin package reservation detail: leakage', () => {
  it('exposes no internal database ids', async () => {
    const captured = await detailOf([row({ id: '42', package_id: '7', variant_id: '9' })]);
    const detail = dataOf(captured);

    assert.deepEqual(Object.keys(detail).sort(), [
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
    assert.deepEqual(Object.keys(detail.package as object).sort(), ['code', 'slug', 'title']);
    assert.deepEqual(Object.keys(detail.variant as object).sort(), ['key', 'label']);

    const serialized = JSON.stringify(captured.body);
    for (const leaked of ['"id"', '"packageId"', '"variantId"', 'package_id', 'variant_id']) {
      assert.ok(!serialized.includes(leaked), `${leaked} must not reach an admin response`);
    }
  });
});
