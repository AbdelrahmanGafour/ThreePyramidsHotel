import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { before, describe, it } from 'node:test';
import {
  PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_CODE,
  PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_MESSAGE,
  PackageReservationError,
  PackageReservationOutcomeUncertainError,
} from '../src/modules/package-reservations/package-reservations.types';

// How the handler turns each failure into a response. The service is imported
// lazily behind a placeholder DATABASE_URL and its client factory is replaced,
// so a COMMIT that throws is reachable without a database.

type ServiceModule = typeof import('../src/modules/package-reservations/package-reservations.service.js');
type ControllerModule = typeof import('../src/modules/package-reservations/package-reservations.controller.js');

let createPackageReservationHandler: ControllerModule['createPackageReservationHandler'];
let __setClientFactoryForTests: ServiceModule['__setClientFactoryForTests'];

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ __setClientFactoryForTests } = await import(
    '../src/modules/package-reservations/package-reservations.service.js'
  ));
  ({ createPackageReservationHandler } = await import(
    '../src/modules/package-reservations/package-reservations.controller.js'
  ));
});

type Captured = { status: number | undefined; body: unknown };

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { status: undefined, body: undefined };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
  } as unknown as Response;

  return { res, captured };
}

/** A client whose COMMIT throws, which is what makes the outcome uncertain. */
function commitFailingClient(): PoolClientLike {
  return {
    async query(text: string, values?: unknown[]): Promise<unknown> {
      if (text.startsWith('COMMIT')) {
        throw Object.assign(new Error('terminating connection due to administrator command'), {
          code: '57P01',
          detail: "Key (guest_email)=(amira@example.test) already exists.",
          where: 'SQL statement "INSERT INTO package_reservations"',
        });
      }
      if (text.includes('FROM packages')) {
        return { rows: [{ id: '1', code: 'T001', slug: 'tour-to-giza-pyramids-and-sphinx',
          title: 'Tour to Giza Pyramids and Sphinx', operating_days: null,
          requires_price_confirmation: false }] };
      }
      if (text.includes('FROM package_variants')) {
        return { rows: [{ id: '10', key: 'standard', label: 'Standard', is_default: true,
          child_min_age: null, child_max_age: null, child_discount_percent: null }] };
      }
      if (text.includes('FROM package_rate_tiers')) {
        return { rows: [{ adult_unit_rate: '92.00', currency: 'USD' }] };
      }
      if (text.includes('INSERT INTO package_reservations')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
    release(): void {},
  };
}

type PoolClientLike = { query(text: string, values?: unknown[]): Promise<unknown>; release(reason?: unknown): void };

const requestBody = {
  packageSlug: 'tour-to-giza-pyramids-and-sphinx',
  tourDate: '2099-06-15',
  adults: 2,
  children: 0,
  guestFirstName: 'Amira',
  guestLastName: 'Hassan',
  guestEmail: 'amira@example.test',
  guestPhone: '+201000000000',
  guestCountry: 'Egypt',
};

async function handle(body: unknown): Promise<Captured> {
  const { res, captured } = fakeResponse();
  await createPackageReservationHandler({ body } as Request, res);
  return captured;
}

describe('uncertain commit maps to the fixed 503 contract', () => {
  it('answers 503 with the exact frozen body', async () => {
    __setClientFactoryForTests(async () => commitFailingClient() as never);
    try {
      const captured = await handle(requestBody);

      assert.equal(captured.status, 503);
      assert.deepEqual(captured.body, {
        error: {
          code: 'PACKAGE_RESERVATION_OUTCOME_UNCERTAIN',
          message: 'The reservation outcome could not be confirmed. Contact the hotel before submitting another request.',
        },
      });
    } finally {
      __setClientFactoryForTests(null);
    }
  });

  it('leaks no SQL, constraint, guest PII or internal id', async () => {
    __setClientFactoryForTests(async () => commitFailingClient() as never);
    try {
      const serialised = JSON.stringify((await handle(requestBody)).body);

      for (const forbidden of [
        'amira@example.test', 'Amira', 'Hassan', '+201000000000',
        'INSERT INTO', 'package_reservations', 'Key (', '57P01',
        'terminating connection', 'administrator command',
      ]) {
        assert.ok(!serialised.includes(forbidden), `response leaked: ${forbidden}`);
      }
    } finally {
      __setClientFactoryForTests(null);
    }
  });

  it('claims neither success nor failure nor rollback', async () => {
    const message = PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_MESSAGE;

    assert.match(message, /could not be confirmed/);
    assert.doesNotMatch(message, /\bfailed\b|could not be created|\bcreated\b/i);
    assert.doesNotMatch(message, /rolled back|rollback/i);
    assert.doesNotMatch(message, /\bsuccess/i);
    assert.doesNotMatch(message, /nothing was/i);
    // It must not invite an immediate resubmit of a request that may already
    // have been written.
    assert.doesNotMatch(message, /try again|retry|resubmit/i);
  });

  it('keeps the uncertainty code distinct from the definite-failure code', () => {
    assert.notEqual(PACKAGE_RESERVATION_OUTCOME_UNCERTAIN_ERROR_CODE, 'PACKAGE_RESERVATION_FAILED');
  });
});

describe('every other failure keeps its existing contract', () => {
  it('still answers 500 PACKAGE_RESERVATION_FAILED for an unexpected error', async () => {
    __setClientFactoryForTests(async () => {
      throw new Error('pool exhausted');
    });
    try {
      const captured = await handle(requestBody);

      assert.equal(captured.status, 500);
      assert.deepEqual(captured.body, {
        error: { code: 'PACKAGE_RESERVATION_FAILED', message: 'Package reservation could not be created' },
      });
    } finally {
      __setClientFactoryForTests(null);
    }
  });

  it('still answers the domain status for a validation refusal', async () => {
    const captured = await handle({ ...requestBody, adults: 0 });

    assert.equal(captured.status, 400);
    assert.equal((captured.body as { error: { code: string } }).error.code, 'INVALID_PACKAGE_RESERVATION');
  });

  it('still rejects an unknown field before touching the database', async () => {
    const captured = await handle({ ...requestBody, currency: 'USD', total: '0.01' });

    assert.equal(captured.status, 400);
    assert.equal((captured.body as { error: { code: string } }).error.code, 'INVALID_PACKAGE_RESERVATION');
  });
});

describe('error type separation', () => {
  it('an uncertainty error is not a domain refusal', () => {
    const uncertain = new PackageReservationOutcomeUncertainError(new Error('lost'));

    assert.ok(!(uncertain instanceof PackageReservationError));
    assert.equal(uncertain.name, 'PackageReservationOutcomeUncertainError');
  });
});
