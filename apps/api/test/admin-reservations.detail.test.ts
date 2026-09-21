import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

// Covers the detail lookup without a database: `dbPool.query` is swapped for a
// recorder, so the real function runs and the query it issues can be inspected.
// That is deliberate here — the lookup must stay an exact, parameterised match,
// and a case-folded or interpolated reference is precisely the regression worth
// catching early. Real execution against PostgreSQL is the integration suite's
// job, in a later step.
type RepositoryModule = typeof import('../src/modules/admin-reservations/admin-reservations.repository.js');
type Pool = typeof import('../src/db/pool.js');

let findAdminReservationByReference: RepositoryModule['findAdminReservationByReference'];
let toAdminReservationDetail: RepositoryModule['toAdminReservationDetail'];
let dbPool: Pool['dbPool'];

type RecordedCall = { text: string; values: unknown[] };

let calls: RecordedCall[] = [];
let nextRows: unknown[] = [];
let originalQuery: unknown;

const REFERENCE = 'TPH-A2B3C4D5E6F7';

const baseRow = {
  booking_reference: REFERENCE,
  status: 'pending',
  guest_first_name: 'Amelia',
  guest_last_name: 'Hartwell',
  guest_email: 'amelia@example.com',
  guest_phone: '+201000000000',
  guest_country: 'Egypt',
  check_in: '2026-09-18',
  check_out: '2026-09-21',
  nights: 3,
  adults: 2,
  children: 0,
  room_type_slug: 'room-concept-02',
  room_type_name: 'Plateau Suite',
  room_number: 'TP-204',
  nightly_rate: '4500.00',
  total_amount: '13500.00',
  currency: 'EGP',
  special_requests: 'Late arrival',
  created_at: new Date('2026-09-14T11:05:22.411Z'),
};

const expectedDetail = {
  bookingReference: REFERENCE,
  status: 'pending',
  guest: {
    firstName: 'Amelia',
    lastName: 'Hartwell',
    email: 'amelia@example.com',
    phone: '+201000000000',
    country: 'Egypt',
  },
  stay: { checkIn: '2026-09-18', checkOut: '2026-09-21', nights: 3, adults: 2, children: 0 },
  roomType: { slug: 'room-concept-02', name: 'Plateau Suite' },
  room: { number: 'TP-204' },
  pricing: { nightlyRate: '4500.00', totalAmount: '13500.00', currency: 'EGP' },
  specialRequests: 'Late arrival',
  createdAt: '2026-09-14T11:05:22.411Z',
};

before(async () => {
  // The repository's module graph reaches db/pool, which requires DATABASE_URL
  // at import time. Nothing here connects: the pool's query is replaced before
  // any call, and a placeholder is enough to load the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ findAdminReservationByReference, toAdminReservationDetail } = await import(
    '../src/modules/admin-reservations/admin-reservations.repository.js'
  ));

  originalQuery = dbPool.query;
  // node:test runs each file in its own process, so this cannot reach another
  // suite; it is restored below regardless.
  (dbPool as unknown as { query: unknown }).query = (text: string, values: unknown[]) => {
    calls.push({ text, values });
    return Promise.resolve({ rows: nextRows });
  };
});

after(() => {
  (dbPool as unknown as { query: unknown }).query = originalQuery;
});

beforeEach(() => {
  calls = [];
  nextRows = [];
});

/** The SELECT list alone, so assertions about it cannot match a JOIN condition. */
function selectClause(text: string): string {
  return text.slice(text.indexOf('SELECT'), text.indexOf('FROM'));
}

describe('findAdminReservationByReference', () => {
  describe('the query it issues', () => {
    it('matches the booking reference exactly, with no case folding', async () => {
      nextRows = [baseRow];
      await findAdminReservationByReference(REFERENCE);

      const call = calls[0];
      assert.ok(call, 'expected exactly one query');
      assert.equal(calls.length, 1);
      assert.match(call.text, /WHERE r\.booking_reference = \$1/);
      // A case-insensitive lookup would also defeat the unique index.
      assert.doesNotMatch(call.text, /lower\(|upper\(|ILIKE/i);
    });

    it('passes the reference as a parameter rather than interpolating it', async () => {
      nextRows = [baseRow];
      await findAdminReservationByReference(REFERENCE);

      const call = calls[0]!;
      assert.deepEqual(call.values, [REFERENCE]);
      assert.ok(!call.text.includes(REFERENCE), 'the reference must never appear in the SQL text');
    });

    it('joins the room type and the physical room', async () => {
      nextRows = [baseRow];
      await findAdminReservationByReference(REFERENCE);

      const { text } = calls[0]!;
      assert.match(text, /JOIN room_types rt ON rt\.id = r\.room_type_id/);
      assert.match(text, /JOIN rooms rm ON rm\.id = r\.room_id/);
    });

    it('selects no internal identifier or column outside the contract', async () => {
      nextRows = [baseRow];
      await findAdminReservationByReference(REFERENCE);

      const selected = selectClause(calls[0]!.text);
      for (const forbidden of ['updated_at', 'is_active', 'room_type_id', 'room_id', 'sort_order']) {
        assert.ok(!selected.includes(forbidden), `${forbidden} must not be selected`);
      }
      assert.doesNotMatch(selected, /\bid\b/, 'no bare id column may be selected');
    });
  });

  describe('its result', () => {
    it('returns the mapped reservation when one matches', async () => {
      nextRows = [baseRow];

      assert.deepEqual(await findAdminReservationByReference(REFERENCE), expectedDetail);
    });

    it('returns null when nothing matches', async () => {
      nextRows = [];

      assert.equal(await findAdminReservationByReference(REFERENCE), null);
    });

    it('raises rather than returning null when the stored row is unusable', async () => {
      nextRows = [{ ...baseRow, status: 'checked-in' }];

      // A data fault is a server problem; reporting it as "no such booking"
      // would hide a real reservation behind a 404.
      await assert.rejects(() => findAdminReservationByReference(REFERENCE), /status/);
    });
  });
});

describe('toAdminReservationDetail', () => {
  it('maps a row onto exactly the detail contract', () => {
    const detail = toAdminReservationDetail(baseRow);

    assert.deepEqual(detail, expectedDetail);
    assert.deepEqual(Object.keys(detail).sort(), [
      'bookingReference',
      'createdAt',
      'guest',
      'pricing',
      'room',
      'roomType',
      'specialRequests',
      'status',
      'stay',
    ]);
    assert.deepEqual(Object.keys(detail.guest).sort(), ['country', 'email', 'firstName', 'lastName', 'phone']);
    assert.deepEqual(Object.keys(detail.stay).sort(), ['adults', 'checkIn', 'checkOut', 'children', 'nights']);
    assert.deepEqual(Object.keys(detail.room), ['number']);
    assert.deepEqual(Object.keys(detail.pricing).sort(), ['currency', 'nightlyRate', 'totalAmount']);
  });

  it('carries no internal identifier into the contract', () => {
    const detail = toAdminReservationDetail(baseRow);
    const fields = detail as unknown as Record<string, unknown>;

    for (const field of ['id', 'roomId', 'roomTypeId', 'updatedAt']) {
      assert.ok(!(field in fields), `${field} must not appear in the detail contract`);
    }
    assert.deepEqual(Object.keys(detail.room), ['number'], 'the room carries its number and nothing else');
  });

  it('returns both money values as the exact strings PostgreSQL gave', () => {
    for (const [nightlyRate, totalAmount] of [
      ['4500.00', '13500.00'],
      ['999.99', '2999.97'],
      ['0.00', '0.00'],
      ['12345678.90', '12345678.90'],
    ]) {
      const { pricing } = toAdminReservationDetail({
        ...baseRow,
        nightly_rate: nightlyRate!,
        total_amount: totalAmount!,
      });

      assert.equal(pricing.nightlyRate, nightlyRate);
      assert.equal(pricing.totalAmount, totalAmount);
      assert.equal(typeof pricing.totalAmount, 'string');
    }
  });

  it('returns the stay dates exactly as PostgreSQL rendered them', () => {
    const { stay } = toAdminReservationDetail({
      ...baseRow,
      check_in: '2026-12-31',
      check_out: '2027-01-02',
    });

    assert.equal(stay.checkIn, '2026-12-31');
    assert.equal(stay.checkOut, '2027-01-02');
  });

  it('uses the nights PostgreSQL derived, without recomputing them', () => {
    assert.equal(toAdminReservationDetail({ ...baseRow, nights: 7 }).stay.nights, 7);
    assert.equal(toAdminReservationDetail({ ...baseRow, nights: 1 }).stay.nights, 1);
  });

  it('accepts a party with no children, which is ordinary', () => {
    assert.equal(toAdminReservationDetail({ ...baseRow, children: 0 }).stay.children, 0);
    assert.equal(toAdminReservationDetail({ ...baseRow, adults: 1, children: 4 }).stay.children, 4);
  });

  it('renders created_at as an ISO 8601 instant', () => {
    const detail = toAdminReservationDetail({
      ...baseRow,
      created_at: new Date('2026-03-01T00:00:00.000Z'),
    });

    assert.equal(detail.createdAt, '2026-03-01T00:00:00.000Z');
  });

  it('accepts every status the schema allows', () => {
    for (const status of ['pending', 'confirmed', 'cancelled']) {
      assert.equal(toAdminReservationDetail({ ...baseRow, status }).status, status);
    }
  });

  it('keeps special requests as text when present', () => {
    assert.equal(toAdminReservationDetail(baseRow).specialRequests, 'Late arrival');
    assert.equal(toAdminReservationDetail({ ...baseRow, special_requests: '' }).specialRequests, '');
  });

  it('keeps special requests null when the column is null', () => {
    assert.equal(toAdminReservationDetail({ ...baseRow, special_requests: null }).specialRequests, null);
  });

  describe('refuses a row the schema should have made impossible', () => {
    const malformed: [string, Record<string, unknown>, RegExp][] = [
      ['an unknown status', { status: 'checked-in' }, /status/],
      ['a blank status', { status: '' }, /status/],
      ['a currency other than EGP', { currency: 'USD' }, /currency/],
      ['a created_at that is not a Date', { created_at: '2026-03-01T00:00:00Z' }, /created_at/],
      ['an invalid created_at', { created_at: new Date('not-a-date') }, /created_at/],
      ['nights as a string', { nights: '3' }, /nights/],
      ['a fractional nights count', { nights: 2.5 }, /nights/],
      ['a negative nights count', { nights: -1 }, /nights/],
      // check_out > check_in is a CHECK constraint, so a stay cannot be zero nights.
      ['a stay of zero nights', { nights: 0 }, /nights/],
      ['adults as a string', { adults: '2' }, /adults/],
      ['a fractional adults count', { adults: 1.5 }, /adults/],
      ['a negative adults count', { adults: -1 }, /adults/],
      // adults > 0 is a CHECK constraint: a reservation always has one.
      ['a party with no adults', { adults: 0 }, /adults/],
      ['a negative children count', { children: -1 }, /children/],
      ['a missing guest name', { guest_first_name: undefined }, /guest_first_name/],
      ['a non-string guest email', { guest_email: 42 }, /guest_email/],
      ['a missing room number', { room_number: null }, /room_number/],
      ['a non-string nightly rate', { nightly_rate: 4500 }, /nightly_rate/],
    ];

    for (const [label, overrides, expected] of malformed) {
      it(`rejects ${label}`, () => {
        assert.throws(
          () => toAdminReservationDetail({ ...baseRow, ...overrides } as typeof baseRow),
          expected,
          `expected ${label} to raise`,
        );
      });
    }
  });
});
