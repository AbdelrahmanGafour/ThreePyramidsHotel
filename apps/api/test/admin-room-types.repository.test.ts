import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// Covers the repository's pure parts only: row mapping. The SQL itself is left
// to T01-D's integration tests against real PostgreSQL — asserting on query
// strings here would test the text, not the behaviour. No pool is mocked and
// no connection is made.
type RepositoryModule = typeof import('../src/modules/admin-room-types/admin-room-types.repository.js');

let toAdminRoomTypeListItem: RepositoryModule['toAdminRoomTypeListItem'];
let toAdminRoomTypeDetail: RepositoryModule['toAdminRoomTypeDetail'];

before(async () => {
  // The repository's module graph reaches db/pool, which requires DATABASE_URL
  // at import time. Nothing here connects or queries, so a placeholder is enough.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ toAdminRoomTypeListItem, toAdminRoomTypeDetail } = await import(
    '../src/modules/admin-room-types/admin-room-types.repository.js'
  ));
});

const CREATED_AT = new Date('2026-01-05T08:30:00.000Z');
const UPDATED_AT = new Date('2026-09-20T18:45:22.411Z');

const listRow = {
  slug: 'room-concept-02',
  name: 'Plateau Suite',
  capacity: 2,
  base_nightly_rate: '1500.00',
  is_active: true,
  sort_order: 2,
  room_count: 4,
  updated_at: UPDATED_AT,
};

const detailRow = {
  ...listRow,
  short_description: 'An upper-floor suite.',
  description: 'A longer passage about the room.',
  bed_type: 'King bed',
  bed_count: 1,
  size_sqm: '42.00',
  view: 'Terrace & plateau view',
  created_at: CREATED_AT,
};

describe('toAdminRoomTypeListItem', () => {
  it('maps a full row onto exactly the list contract', () => {
    const item = toAdminRoomTypeListItem(listRow);

    assert.deepEqual(item, {
      slug: 'room-concept-02',
      name: 'Plateau Suite',
      capacity: 2,
      baseNightlyRate: '1500.00',
      currency: 'EGP',
      isActive: true,
      sortOrder: 2,
      roomCount: 4,
      updatedAt: '2026-09-20T18:45:22.411Z',
    });

    assert.deepEqual(Object.keys(item).sort(), [
      'baseNightlyRate',
      'capacity',
      'currency',
      'isActive',
      'name',
      'roomCount',
      'slug',
      'sortOrder',
      'updatedAt',
    ]);
  });

  it('carries no internal identifier into the contract', () => {
    const item = toAdminRoomTypeListItem({ ...listRow, id: '42' } as typeof listRow);
    const fields = item as unknown as Record<string, unknown>;

    for (const field of ['id', 'roomTypeId', 'createdAt']) {
      assert.ok(!(field in fields), `${field} must not appear in the list contract`);
    }
  });

  it('keeps a room type with no physical rooms, counted as zero', () => {
    // The state worth noticing: such a type can never be booked.
    assert.equal(toAdminRoomTypeListItem({ ...listRow, room_count: 0 }).roomCount, 0);
  });

  it('keeps an inactive room type', () => {
    // The admin list is deliberately unfiltered; only the public one hides these.
    assert.equal(toAdminRoomTypeListItem({ ...listRow, is_active: false }).isActive, false);
  });

  it('returns the rate as the exact string PostgreSQL gave', () => {
    for (const rate of ['1500.00', '999.99', '0.00', '9999999999.99', '1500']) {
      const item = toAdminRoomTypeListItem({ ...listRow, base_nightly_rate: rate });

      assert.equal(item.baseNightlyRate, rate);
      assert.equal(typeof item.baseNightlyRate, 'string');
    }
  });

  it('renders updated_at as an ISO 8601 instant', () => {
    assert.match(toAdminRoomTypeListItem(listRow).updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('toAdminRoomTypeDetail', () => {
  it('maps a full row onto exactly the detail contract', () => {
    const detail = toAdminRoomTypeDetail(detailRow);

    assert.deepEqual(detail, {
      slug: 'room-concept-02',
      name: 'Plateau Suite',
      shortDescription: 'An upper-floor suite.',
      description: 'A longer passage about the room.',
      capacity: 2,
      bedType: 'King bed',
      bedCount: 1,
      sizeSqm: '42.00',
      view: 'Terrace & plateau view',
      baseNightlyRate: '1500.00',
      currency: 'EGP',
      isActive: true,
      sortOrder: 2,
      roomCount: 4,
      createdAt: '2026-01-05T08:30:00.000Z',
      updatedAt: '2026-09-20T18:45:22.411Z',
    });

    assert.deepEqual(Object.keys(detail).sort(), [
      'baseNightlyRate',
      'bedCount',
      'bedType',
      'capacity',
      'createdAt',
      'currency',
      'description',
      'isActive',
      'name',
      'roomCount',
      'shortDescription',
      'sizeSqm',
      'slug',
      'sortOrder',
      'updatedAt',
      'view',
    ]);
  });

  it('carries no internal identifier into the contract', () => {
    const detail = toAdminRoomTypeDetail({ ...detailRow, id: '42' } as typeof detailRow);
    const fields = detail as unknown as Record<string, unknown>;

    for (const field of ['id', 'roomTypeId', 'roomId', 'roomNumber']) {
      assert.ok(!(field in fields), `${field} must not appear in the detail contract`);
    }
  });

  it('keeps every nullable column null', () => {
    const detail = toAdminRoomTypeDetail({
      ...detailRow,
      short_description: null,
      description: null,
      bed_type: null,
      bed_count: null,
      size_sqm: null,
      view: null,
    });

    assert.equal(detail.shortDescription, null);
    assert.equal(detail.description, null);
    assert.equal(detail.bedType, null);
    assert.equal(detail.bedCount, null);
    assert.equal(detail.sizeSqm, null);
    assert.equal(detail.view, null);
  });

  it('returns both decimals as the exact strings PostgreSQL gave', () => {
    const detail = toAdminRoomTypeDetail({
      ...detailRow,
      base_nightly_rate: '999.99',
      size_sqm: '38.50',
    });

    assert.equal(detail.baseNightlyRate, '999.99');
    assert.equal(detail.sizeSqm, '38.50');
    assert.equal(typeof detail.sizeSqm, 'string');
  });

  it('renders both timestamps as ISO 8601 instants', () => {
    const detail = toAdminRoomTypeDetail(detailRow);

    assert.equal(detail.createdAt, '2026-01-05T08:30:00.000Z');
    assert.equal(detail.updatedAt, '2026-09-20T18:45:22.411Z');
  });

  it('handles a zero room count and an inactive type together', () => {
    const detail = toAdminRoomTypeDetail({ ...detailRow, room_count: 0, is_active: false });

    assert.equal(detail.roomCount, 0);
    assert.equal(detail.isActive, false);
  });

  it('always reports EGP, whatever a row might carry', () => {
    // Currency is not read from the row at all: V1 is EGP-only and the
    // reservation column's CHECK is what enforces it.
    const detail = toAdminRoomTypeDetail({ ...detailRow, currency: 'USD' } as typeof detailRow);

    assert.equal(detail.currency, 'EGP');
  });
});

describe('refuses a row the schema should have made impossible', () => {
  const malformedList: [string, Record<string, unknown>, RegExp][] = [
    ['a missing slug', { slug: undefined }, /slug/],
    ['a non-string name', { name: 42 }, /name/],
    ['a capacity of zero', { capacity: 0 }, /capacity/],
    ['a fractional capacity', { capacity: 2.5 }, /capacity/],
    ['a numeric rate instead of a decimal string', { base_nightly_rate: 1500 }, /base_nightly_rate/],
    ['an empty rate', { base_nightly_rate: '' }, /base_nightly_rate/],
    ['a null rate', { base_nightly_rate: null }, /base_nightly_rate/],
    ['a non-boolean is_active', { is_active: 'true' }, /is_active/],
    ['a negative sort_order', { sort_order: -1 }, /sort_order/],
    ['a non-numeric room count string', { room_count: 'four' }, /room_count/],
    ['a negative room count', { room_count: -1 }, /room_count/],
    ['updated_at as a string', { updated_at: '2026-09-20T18:45:22.411Z' }, /updated_at/],
    ['an invalid updated_at', { updated_at: new Date('not-a-date') }, /updated_at/],
  ];

  for (const [label, overrides, expected] of malformedList) {
    it(`rejects ${label} in a list row`, () => {
      assert.throws(
        () => toAdminRoomTypeListItem({ ...listRow, ...overrides } as typeof listRow),
        expected,
        `expected ${label} to raise`,
      );
    });
  }

  const malformedDetail: [string, Record<string, unknown>, RegExp][] = [
    ['a non-string short_description', { short_description: 42 }, /short_description/],
    ['a non-string description', { description: {} }, /description/],
    ['a non-string bed_type', { bed_type: 1 }, /bed_type/],
    ['a bed_count of zero', { bed_count: 0 }, /bed_count/],
    ['a fractional bed_count', { bed_count: 1.5 }, /bed_count/],
    ['a numeric size_sqm', { size_sqm: 42 }, /size_sqm/],
    ['an empty size_sqm', { size_sqm: '' }, /size_sqm/],
    ['a non-string view', { view: true }, /view/],
    ['created_at as a string', { created_at: '2026-01-05' }, /created_at/],
    ['an invalid created_at', { created_at: new Date('not-a-date') }, /created_at/],
  ];

  for (const [label, overrides, expected] of malformedDetail) {
    it(`rejects ${label} in a detail row`, () => {
      assert.throws(
        () => toAdminRoomTypeDetail({ ...detailRow, ...overrides } as typeof detailRow),
        expected,
        `expected ${label} to raise`,
      );
    });
  }

  it('names the column it refused, so a data fault is diagnosable', () => {
    assert.throws(
      () => toAdminRoomTypeListItem({ ...listRow, room_count: null } as unknown as typeof listRow),
      /Unexpected room type room_count from the database/,
    );
  });
});
