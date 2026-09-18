import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  RESERVATION_VALIDATION_ERROR_CODE,
  isReservationValidationError,
} from '../src/modules/reservations/reservations.types';

type ParseReservationInput =
  typeof import('../src/modules/reservations/reservations.service.js').parseReservationInput;

let parseReservationInput: ParseReservationInput;

before(async () => {
  // The service's module graph reaches db/pool, which requires DATABASE_URL at
  // import time. These tests are pure: nothing here connects to PostgreSQL or
  // runs a query, so a placeholder value is enough to load the module.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ parseReservationInput } = await import('../src/modules/reservations/reservations.service.js'));
});

const validBody = {
  roomTypeSlug: 'demo-deluxe',
  checkIn: '2026-10-10',
  checkOut: '2026-10-12',
  adults: 2,
  children: 1,
  guestFirstName: 'Runtime',
  guestLastName: 'Test',
  guestEmail: 'guest@example.com',
  guestPhone: '+20 100 000 0000',
  guestCountry: 'Egypt',
  specialRequests: 'Late arrival',
};

function withoutField(field: keyof typeof validBody): Record<string, unknown> {
  const body: Record<string, unknown> = { ...validBody };
  delete body[field];
  return body;
}

function assertRejected(body: unknown): void {
  assert.throws(
    () => parseReservationInput(body),
    (error: unknown) => {
      assert.ok(isReservationValidationError(error), `expected a reservation validation error, got: ${String(error)}`);
      assert.equal(error.code, RESERVATION_VALIDATION_ERROR_CODE);
      assert.ok(error.message.length > 0, 'error should carry a human-readable message');
      return true;
    },
  );
}

describe('parseReservationInput', () => {
  describe('accepts', () => {
    it('a valid reservation, normalized', () => {
      assert.deepEqual(parseReservationInput(validBody), {
        roomTypeSlug: 'demo-deluxe',
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
        adults: 2,
        children: 1,
        nights: 2,
        guestFirstName: 'Runtime',
        guestLastName: 'Test',
        guestEmail: 'guest@example.com',
        guestPhone: '+20 100 000 0000',
        guestCountry: 'Egypt',
        specialRequests: 'Late arrival',
      });
    });

    it('untrimmed guest fields, trimming them', () => {
      const input = parseReservationInput({
        ...validBody,
        roomTypeSlug: '  demo-deluxe  ',
        guestFirstName: '  Runtime  ',
        guestLastName: '  Test  ',
        guestPhone: '  +20 100 000 0000  ',
        guestCountry: '  Egypt  ',
        specialRequests: '  Late arrival  ',
      });

      assert.equal(input.roomTypeSlug, 'demo-deluxe');
      assert.equal(input.guestFirstName, 'Runtime');
      assert.equal(input.guestLastName, 'Test');
      assert.equal(input.guestPhone, '+20 100 000 0000');
      assert.equal(input.guestCountry, 'Egypt');
      assert.equal(input.specialRequests, 'Late arrival');
    });

    it('a mixed-case email, lowercasing it', () => {
      assert.equal(
        parseReservationInput({ ...validBody, guestEmail: '  Guest@Example.COM  ' }).guestEmail,
        'guest@example.com',
      );
    });

    it('omitted children, defaulting to 0', () => {
      assert.equal(parseReservationInput(withoutField('children')).children, 0);
    });

    it('a blank specialRequests, storing null', () => {
      assert.equal(parseReservationInput({ ...validBody, specialRequests: '   ' }).specialRequests, null);
    });

    it('omitted or null specialRequests, storing null', () => {
      assert.equal(parseReservationInput(withoutField('specialRequests')).specialRequests, null);
      assert.equal(parseReservationInput({ ...validBody, specialRequests: null }).specialRequests, null);
    });

    it('a stay across a month boundary, counting nights correctly', () => {
      const input = parseReservationInput({ ...validBody, checkIn: '2026-10-30', checkOut: '2026-11-02' });
      assert.equal(input.nights, 3);
    });

    it('a null-prototype object', () => {
      const body = Object.assign(Object.create(null), validBody);
      assert.equal(parseReservationInput(body).roomTypeSlug, 'demo-deluxe');
    });

    it('without mutating the caller’s body', () => {
      const body = { ...validBody };
      const snapshot = JSON.stringify(body);
      parseReservationInput(body);
      assert.equal(JSON.stringify(body), snapshot);
    });
  });

  describe('rejects', () => {
    it('a non-object body', () => {
      assertRejected('not an object');
      assertRejected(42);
    });

    it('a null body', () => {
      assertRejected(null);
    });

    it('an array body', () => {
      assertRejected([validBody]);
    });

    it('a Date instance body', () => {
      assertRejected(new Date());
    });

    it('a Map instance body', () => {
      assertRejected(new Map(Object.entries(validBody)));
    });

    it('a class instance body', () => {
      class ReservationRequest {
        roomTypeSlug = validBody.roomTypeSlug;
      }
      assertRejected(new ReservationRequest());
    });

    it('an impossible date such as 2026-02-30', () => {
      assertRejected({ ...validBody, checkIn: '2026-02-30' });
    });

    it('a malformed date format', () => {
      assertRejected({ ...validBody, checkOut: '12-10-2026' });
    });

    it('checkOut equal to checkIn', () => {
      assertRejected({ ...validBody, checkOut: validBody.checkIn });
    });

    it('checkOut before checkIn', () => {
      assertRejected({ ...validBody, checkOut: '2026-10-09' });
    });

    it('adults = 0', () => {
      assertRejected({ ...validBody, adults: 0 });
    });

    it('a decimal guest count', () => {
      assertRejected({ ...validBody, adults: 1.5 });
      assertRejected({ ...validBody, children: 0.5 });
    });

    it('a guest count passed as a string', () => {
      assertRejected({ ...validBody, adults: '2' });
    });

    it('negative children', () => {
      assertRejected({ ...validBody, children: -1 });
    });

    it('adults + children beyond the safe integer range', () => {
      assertRejected({ ...validBody, adults: Number.MAX_SAFE_INTEGER, children: 10 });
    });

    it('an email that fails the basic shape check', () => {
      assertRejected({ ...validBody, guestEmail: 'not-an-email' });
    });

    it('an empty required guest field', () => {
      assertRejected({ ...validBody, guestFirstName: '   ' });
      assertRejected(withoutField('guestPhone'));
      assertRejected(withoutField('guestCountry'));
    });

    it('an empty room type slug', () => {
      assertRejected({ ...validBody, roomTypeSlug: '  ' });
    });

    it('an overlong guest field', () => {
      assertRejected({ ...validBody, guestLastName: 'a'.repeat(101) });
      assertRejected({ ...validBody, roomTypeSlug: 'a'.repeat(121) });
    });

    it('an overlong specialRequests', () => {
      assertRejected({ ...validBody, specialRequests: 'a'.repeat(2001) });
    });

    it('a client-supplied roomId', () => {
      assertRejected({ ...validBody, roomId: '42' });
    });

    it('a client-supplied totalAmount', () => {
      assertRejected({ ...validBody, totalAmount: '0.01' });
    });

    it('a client-supplied status', () => {
      assertRejected({ ...validBody, status: 'confirmed' });
    });

    it('a client-supplied currency or booking reference', () => {
      assertRejected({ ...validBody, currency: 'USD' });
      assertRejected({ ...validBody, bookingReference: 'TPH-FAKE1234' });
    });
  });
});
