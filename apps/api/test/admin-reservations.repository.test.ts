import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// Covers the repository's pure parts only: row mapping and count parsing. The
// SQL itself is left to the integration tests a later step will add — asserting
// on query strings here would test the text, not the behaviour. No pool is
// mocked and no connection is made.
type RepositoryModule = typeof import('../src/modules/admin-reservations/admin-reservations.repository.js');

let toAdminReservationListItem: RepositoryModule['toAdminReservationListItem'];
let parseTotalCount: RepositoryModule['parseTotalCount'];

before(async () => {
  // The repository's module graph reaches db/pool, which requires DATABASE_URL
  // at import time. Nothing here connects or queries, so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ toAdminReservationListItem, parseTotalCount } = await import(
    '../src/modules/admin-reservations/admin-reservations.repository.js'
  ));
});

const baseRow = {
  booking_reference: 'A1B2C3D4E5F6',
  guest_first_name: 'Amelia',
  guest_last_name: 'Hartwell',
  guest_email: 'amelia@example.com',
  room_type_slug: 'room-concept-02',
  room_type_name: 'Plateau Suite',
  check_in: '2026-09-18',
  check_out: '2026-09-21',
  status: 'pending',
  total_amount: '13500.00',
  currency: 'EGP',
  created_at: new Date('2026-09-14T11:05:22.411Z'),
};

describe('toAdminReservationListItem', () => {
  it('maps a row onto exactly the list contract', () => {
    // deepEqual also proves nothing extra is carried across: no id, room id,
    // room number, nightly rate, party size, phone, country or requests.
    assert.deepEqual(toAdminReservationListItem(baseRow), {
      bookingReference: 'A1B2C3D4E5F6',
      guestName: 'Amelia Hartwell',
      guestEmail: 'amelia@example.com',
      roomType: { slug: 'room-concept-02', name: 'Plateau Suite' },
      checkIn: '2026-09-18',
      checkOut: '2026-09-21',
      status: 'pending',
      totalAmount: '13500.00',
      currency: 'EGP',
      createdAt: '2026-09-14T11:05:22.411Z',
    });
  });

  it('composes one guest name from the two stored columns', () => {
    const item = toAdminReservationListItem({
      ...baseRow,
      guest_first_name: 'Karim',
      guest_last_name: 'Mansour',
    });

    assert.equal(item.guestName, 'Karim Mansour');
    assert.ok(!('guestFirstName' in item), 'the separate name fields must not be exposed');
    assert.ok(!('guestLastName' in item), 'the separate name fields must not be exposed');
  });

  it('returns the stored money string untouched', () => {
    for (const amount of ['13500.00', '0.00', '999.99', '12345678.90']) {
      assert.equal(toAdminReservationListItem({ ...baseRow, total_amount: amount }).totalAmount, amount);
    }
  });

  it('returns the stay dates exactly as PostgreSQL rendered them', () => {
    const item = toAdminReservationListItem({
      ...baseRow,
      check_in: '2026-01-01',
      check_out: '2026-01-02',
    });

    assert.equal(item.checkIn, '2026-01-01');
    assert.equal(item.checkOut, '2026-01-02');
  });

  it('renders created_at as an ISO 8601 instant', () => {
    const item = toAdminReservationListItem({
      ...baseRow,
      created_at: new Date('2026-03-01T00:00:00.000Z'),
    });

    assert.equal(item.createdAt, '2026-03-01T00:00:00.000Z');
  });

  it('accepts every status the schema allows', () => {
    for (const status of ['pending', 'confirmed', 'cancelled']) {
      assert.equal(toAdminReservationListItem({ ...baseRow, status }).status, status);
    }
  });

  it('refuses a status the schema should have made impossible', () => {
    assert.throws(() => toAdminReservationListItem({ ...baseRow, status: 'checked-in' }), /status/);
    assert.throws(() => toAdminReservationListItem({ ...baseRow, status: '' }), /status/);
  });

  it('refuses a currency other than EGP', () => {
    assert.throws(() => toAdminReservationListItem({ ...baseRow, currency: 'USD' }), /currency/);
  });

  it('refuses an invalid timestamp', () => {
    assert.throws(
      () => toAdminReservationListItem({ ...baseRow, created_at: new Date('not-a-date') }),
      /created_at/,
    );
  });
});

describe('parseTotalCount', () => {
  it('parses a counted bigint string', () => {
    assert.equal(parseTotalCount('0'), 0);
    assert.equal(parseTotalCount('1'), 1);
    assert.equal(parseTotalCount('42'), 42);
  });

  it('parses the largest exactly representable count', () => {
    assert.equal(parseTotalCount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  });

  it('refuses a count beyond exact integer arithmetic rather than rounding it', () => {
    assert.throws(() => parseTotalCount('9007199254740993'), /exact integer/);
  });

  it('refuses anything that is not a digits-only string', () => {
    for (const value of ['', ' ', ' 1', '1 ', '-1', '1.5', '1e3', 'abc', '1,000']) {
      assert.throws(() => parseTotalCount(value), `expected ${JSON.stringify(value)} to be refused`);
    }
  });

  it('refuses a value that is not a string, including a missing row', () => {
    // A number here would mean an int8 type parser had already rounded it.
    for (const value of [42, null, undefined, {}, ['1']]) {
      assert.throws(() => parseTotalCount(value), `expected ${String(value)} to be refused`);
    }
  });
});
