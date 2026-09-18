import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  AVAILABILITY_QUERY_ERROR_CODE,
  isAvailabilityQueryError,
} from '../src/modules/availability/availability.types';

type ParseAvailabilityQuery =
  typeof import('../src/modules/availability/availability.service.js').parseAvailabilityQuery;

let parseAvailabilityQuery: ParseAvailabilityQuery;

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. These tests are pure: nothing here connects to PostgreSQL or
  // runs a query, so a placeholder value is enough to load the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ parseAvailabilityQuery } = await import('../src/modules/availability/availability.service.js'));
});

const validQuery = { checkIn: '2026-10-10', checkOut: '2026-10-12', adults: '2', children: '0' };

function assertRejected(query: Record<string, unknown>): void {
  assert.throws(
    () => parseAvailabilityQuery(query),
    (error: unknown) => {
      assert.ok(isAvailabilityQueryError(error), `expected an availability query error, got: ${String(error)}`);
      assert.equal(error.code, AVAILABILITY_QUERY_ERROR_CODE);
      assert.ok(error.message.length > 0, 'error should carry a human-readable message');
      return true;
    },
  );
}

describe('parseAvailabilityQuery', () => {
  describe('accepts', () => {
    it('a valid query', () => {
      assert.deepEqual(parseAvailabilityQuery(validQuery), {
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
        adults: 2,
        children: 0,
        nights: 2,
      });
    });

    it('omitted children, defaulting to 0', () => {
      const { children, ...withoutChildren } = validQuery;
      assert.equal(parseAvailabilityQuery(withoutChildren).children, 0);
    });

    it('explicit children counts', () => {
      assert.equal(parseAvailabilityQuery({ ...validQuery, children: '3' }).children, 3);
    });

    it('a multi-night stay, counting nights correctly', () => {
      assert.equal(parseAvailabilityQuery({ ...validQuery, checkOut: '2026-10-17' }).nights, 7);
    });

    it('a stay across a month boundary', () => {
      const input = parseAvailabilityQuery({ ...validQuery, checkIn: '2026-10-30', checkOut: '2026-11-02' });
      assert.equal(input.nights, 3);
    });

    it('a stay across a leap day', () => {
      const input = parseAvailabilityQuery({ ...validQuery, checkIn: '2028-02-27', checkOut: '2028-03-01' });
      assert.equal(input.nights, 3);
    });

    it('a stay across a daylight-saving change without drifting', () => {
      const input = parseAvailabilityQuery({ ...validQuery, checkIn: '2026-10-24', checkOut: '2026-10-27' });
      assert.equal(input.nights, 3);
    });

    it('without mutating the caller’s query', () => {
      const query = { ...validQuery };
      const snapshot = JSON.stringify(query);
      parseAvailabilityQuery(query);
      assert.equal(JSON.stringify(query), snapshot);
    });
  });

  describe('rejects', () => {
    it('a missing checkIn', () => {
      const { checkIn, ...withoutCheckIn } = validQuery;
      assertRejected(withoutCheckIn);
    });

    it('a missing checkOut', () => {
      const { checkOut, ...withoutCheckOut } = validQuery;
      assertRejected(withoutCheckOut);
    });

    it('an impossible day such as 2026-02-30', () => {
      assertRejected({ ...validQuery, checkIn: '2026-02-30' });
    });

    it('an impossible month such as 2026-13-01', () => {
      assertRejected({ ...validQuery, checkIn: '2026-13-01' });
    });

    it('a malformed date format', () => {
      assertRejected({ ...validQuery, checkIn: '10/10/2026' });
    });

    it('checkOut equal to checkIn', () => {
      assertRejected({ ...validQuery, checkOut: validQuery.checkIn });
    });

    it('checkOut before checkIn', () => {
      assertRejected({ ...validQuery, checkOut: '2026-10-09' });
    });

    it('missing adults', () => {
      const { adults, ...withoutAdults } = validQuery;
      assertRejected(withoutAdults);
    });

    it('adults = 0', () => {
      assertRejected({ ...validQuery, adults: '0' });
    });

    it('negative adults', () => {
      assertRejected({ ...validQuery, adults: '-1' });
    });

    it('decimal adults', () => {
      assertRejected({ ...validQuery, adults: '1.5' });
    });

    it('non-numeric adults such as "2abc"', () => {
      assertRejected({ ...validQuery, adults: '2abc' });
    });

    it('negative children', () => {
      assertRejected({ ...validQuery, children: '-1' });
    });

    it('decimal children', () => {
      assertRejected({ ...validQuery, children: '0.5' });
    });

    it('a repeated (array) date value', () => {
      assertRejected({ ...validQuery, checkIn: ['2026-10-10', '2026-10-11'] });
    });

    it('a repeated (array) adults value', () => {
      assertRejected({ ...validQuery, adults: ['1', '2'] });
    });
  });
});
