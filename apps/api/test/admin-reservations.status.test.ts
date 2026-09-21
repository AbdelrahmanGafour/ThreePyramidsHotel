import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAdminReservationStatusTransitionAllowed } from '../src/modules/admin-reservations/admin-reservations.status';
import {
  INVALID_RESERVATION_STATUS_ERROR_CODE,
  INVALID_RESERVATION_STATUS_ERROR_MESSAGE,
  isInvalidReservationStatusError,
  type AdminReservationStatus,
  type AdminReservationStatusTarget,
} from '../src/modules/admin-reservations/admin-reservations.types';
import { parseAdminReservationStatusUpdate } from '../src/modules/admin-reservations/admin-reservations.validation';

// Pure: neither module reaches the database.

const CURRENT_STATUSES: readonly AdminReservationStatus[] = ['pending', 'confirmed', 'cancelled'];
const TARGET_STATUSES: readonly AdminReservationStatusTarget[] = ['confirmed', 'cancelled'];

/**
 * Every transition V1 permits — the whole list, not a sample.
 *
 * The matrix below is generated from this, so a rule added here without a
 * deliberate decision shows up as a failing test rather than as new behaviour.
 */
const ALLOWED: readonly [AdminReservationStatus, AdminReservationStatusTarget][] = [
  ['pending', 'confirmed'],
  ['pending', 'cancelled'],
  ['confirmed', 'cancelled'],
];

const isAllowed = (from: AdminReservationStatus, to: AdminReservationStatusTarget) =>
  ALLOWED.some(([current, next]) => current === from && next === to);

describe('isAdminReservationStatusTransitionAllowed', () => {
  describe('permits exactly the V1 transitions', () => {
    it('pending -> confirmed', () => {
      assert.equal(isAdminReservationStatusTransitionAllowed('pending', 'confirmed'), true);
    });

    it('pending -> cancelled', () => {
      assert.equal(isAdminReservationStatusTransitionAllowed('pending', 'cancelled'), true);
    });

    it('confirmed -> cancelled', () => {
      assert.equal(isAdminReservationStatusTransitionAllowed('confirmed', 'cancelled'), true);
    });
  });

  describe('refuses everything else', () => {
    it('confirmed -> confirmed, because a same-state move is not a quiet success', () => {
      assert.equal(isAdminReservationStatusTransitionAllowed('confirmed', 'confirmed'), false);
    });

    it('cancelled -> cancelled, for the same reason', () => {
      assert.equal(isAdminReservationStatusTransitionAllowed('cancelled', 'cancelled'), false);
    });

    it('cancelled -> confirmed, because cancelled is terminal', () => {
      assert.equal(isAdminReservationStatusTransitionAllowed('cancelled', 'confirmed'), false);
    });
  });

  // The whole 3x2 grid, asserted cell by cell. Making `cancelled` non-terminal
  // or opening a route back to `pending` cannot pass this quietly: any change
  // to the policy has to change the ALLOWED list above to match, which is a
  // deliberate edit rather than an accident.
  describe('matches the locked matrix cell by cell', () => {
    for (const from of CURRENT_STATUSES) {
      for (const to of TARGET_STATUSES) {
        const expected = isAllowed(from, to);

        it(`${from} -> ${to} is ${expected}`, () => {
          assert.equal(isAdminReservationStatusTransitionAllowed(from, to), expected);
        });
      }
    }
  });

  it('allows exactly three transitions in total', () => {
    const permitted = CURRENT_STATUSES.flatMap((from) =>
      TARGET_STATUSES.filter((to) => isAdminReservationStatusTransitionAllowed(from, to)).map(
        (to) => `${from}->${to}`,
      ),
    );

    assert.deepEqual(permitted, ['pending->confirmed', 'pending->cancelled', 'confirmed->cancelled']);
  });

  it('leaves cancelled with nowhere to go', () => {
    const fromCancelled = TARGET_STATUSES.filter((to) =>
      isAdminReservationStatusTransitionAllowed('cancelled', to),
    );

    assert.deepEqual(fromCancelled, [], 'cancelled is terminal');
  });

  it('offers no way back to pending, because the type forbids asking', () => {
    // `pending` is not an AdminReservationStatusTarget, so this cannot be
    // written without a cast. The cast is the test: even forced through, the
    // policy refuses from every current state.
    for (const from of CURRENT_STATUSES) {
      const asTarget = 'pending' as unknown as AdminReservationStatusTarget;

      assert.equal(
        isAdminReservationStatusTransitionAllowed(from, asTarget),
        false,
        `${from} must not be able to return to pending`,
      );
    }
  });
});

describe('parseAdminReservationStatusUpdate', () => {
  function assertRejected(body: unknown, label: string): void {
    assert.throws(
      () => parseAdminReservationStatusUpdate(body),
      (error: unknown) => {
        assert.ok(
          isInvalidReservationStatusError(error),
          `expected a reservation status error for ${label}, got: ${String(error)}`,
        );
        assert.equal(error.code, INVALID_RESERVATION_STATUS_ERROR_CODE);
        // The message is part of the locked response contract, not free text.
        assert.equal(error.message, INVALID_RESERVATION_STATUS_ERROR_MESSAGE);
        return true;
      },
      `expected ${label} to be rejected`,
    );
  }

  describe('accepts', () => {
    it('confirmed', () => {
      assert.equal(parseAdminReservationStatusUpdate({ status: 'confirmed' }), 'confirmed');
    });

    it('cancelled', () => {
      assert.equal(parseAdminReservationStatusUpdate({ status: 'cancelled' }), 'cancelled');
    });

    it('a body carrying other keys, reading only status', () => {
      const body: Record<string, unknown> = { status: 'cancelled', reason: 'guest called', id: 7 };

      assert.equal(parseAdminReservationStatusUpdate(body), 'cancelled');
    });

    it('without mutating the body', () => {
      const body = { status: 'confirmed' };
      parseAdminReservationStatusUpdate(body);

      assert.deepEqual(body, { status: 'confirmed' });
    });
  });

  describe('rejects', () => {
    it('pending, which is not somewhere a booking can be sent', () => {
      assertRejected({ status: 'pending' }, 'pending');
    });

    it('a missing status', () => {
      assertRejected({}, 'an empty object');
      assertRejected({ state: 'confirmed' }, 'the wrong key');
    });

    it('a null or undefined status', () => {
      assertRejected({ status: null }, 'null status');
      assertRejected({ status: undefined }, 'undefined status');
    });

    it('a missing or non-object body', () => {
      // The validator refuses these in its own right. Over HTTP it never sees
      // them: strict-mode express.json() rejects a top-level JSON primitive
      // before routing, so the request comes back as the global INVALID_JSON
      // instead. Both layers refuse; only the parser gets there first.
      for (const body of [undefined, null, 'confirmed', 42, true]) {
        assertRejected(body, `body ${String(body)}`);
      }
    });

    it('an array body', () => {
      assertRejected(['confirmed'], 'an array body');
      assertRejected([], 'an empty array body');
    });

    it('a non-plain-object body', () => {
      assertRejected(new Date(), 'a Date body');
      assertRejected(new Map([['status', 'confirmed']]), 'a Map body');
    });

    it('a non-string status', () => {
      for (const status of [1, 0, true, false, {}, ['confirmed'], null]) {
        assertRejected({ status }, `status ${JSON.stringify(status)}`);
      }
    });

    it('the wrong case rather than normalising it', () => {
      for (const status of ['CONFIRMED', 'Confirmed', 'cONFIRMED', 'CANCELLED', 'Cancelled']) {
        assertRejected({ status }, status);
      }
    });

    it('surrounding whitespace rather than trimming it', () => {
      for (const status of [' confirmed', 'confirmed ', ' confirmed ', '\tcancelled', 'cancelled\n']) {
        assertRejected({ status }, JSON.stringify(status));
      }
    });

    it('an unknown or near-miss status', () => {
      for (const status of ['', 'confirm', 'confirmedd', 'checked-in', 'checked-out', 'CONFIRM', 'declined']) {
        assertRejected({ status }, JSON.stringify(status));
      }
    });

    it('an American spelling of cancelled', () => {
      assertRejected({ status: 'canceled' }, 'canceled');
    });
  });
});
