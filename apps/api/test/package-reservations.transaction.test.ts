import assert from 'node:assert/strict';
import type { PoolClient } from '../src/db/pool';
import { afterEach, before, describe, it } from 'node:test';
import {
  PackageReservationError,
  PackageReservationOutcomeUncertainError,
} from '../src/modules/package-reservations/package-reservations.types';

// Transaction state machine only. The client is a double, so the one failure
// that cannot be provoked against a healthy PostgreSQL — a COMMIT that throws
// — is reachable here. No pool, no database.
//
// The service is imported lazily behind a placeholder DATABASE_URL, matching
// admin-room-types.service.test.ts: importing it reaches `db/pool`, which
// reads the environment at module load. The connection string is never used,
// because the client factory is replaced before any call.

type ServiceModule = typeof import('../src/modules/package-reservations/package-reservations.service.js');

let createPackageReservation: ServiceModule['createPackageReservation'];
let __setClientFactoryForTests: ServiceModule['__setClientFactoryForTests'];

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ createPackageReservation, __setClientFactoryForTests } = await import(
    '../src/modules/package-reservations/package-reservations.service.js'
  ));
});

const TOUR_DATE = '2099-06-15';

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    packageSlug: 'tour-to-giza-pyramids-and-sphinx',
    tourDate: TOUR_DATE,
    adults: 2,
    children: 0,
    guestFirstName: 'Amira',
    guestLastName: 'Hassan',
    guestEmail: 'amira@example.test',
    guestPhone: '+201000000000',
    guestCountry: 'Egypt',
    ...overrides,
  };
}

type Script = {
  /** Statement text that should throw when issued, e.g. 'COMMIT'. */
  failOn?: string;
  /** Make the INSERT throw, standing in for any pre-commit write failure. */
  failInsert?: boolean;
  /**
   * Make the outbox insert throw this exact object.
   * Separate from `failOn` so the error can carry a SQLSTATE and be compared
   * by identity — the point is that it arrives untranslated.
   */
  outboxError?: unknown;
};

type Recording = {
  statements: string[];
  inserts: number;
  /** Outbox insert attempts, counted separately from the reservation's. */
  outboxInserts: number;
  released: boolean;
  releasedWith: unknown;
};

/**
 * A client that answers the catalogue reads this service performs, records
 * every statement, and fails exactly where the script says.
 */
function scriptedClient(script: Script = {}): { client: PoolClient; log: Recording } {
  const log: Recording = { statements: [], inserts: 0, outboxInserts: 0, released: false, releasedWith: undefined };

  const client = {
    async query(text: string, _values?: unknown[]): Promise<unknown> {
      log.statements.push(text);

      if (script.failOn && text.startsWith(script.failOn)) {
        throw new Error(`simulated failure at ${script.failOn}`);
      }

      if (text.includes('FROM packages')) {
        return {
          rows: [{
            id: '1', code: 'T001', slug: 'tour-to-giza-pyramids-and-sphinx',
            title: 'Tour to Giza Pyramids and Sphinx',
            operating_days: null, requires_price_confirmation: false,
          }],
        };
      }

      if (text.includes('FROM package_variants')) {
        return {
          rows: [{
            id: '10', key: 'standard', label: 'Standard', is_default: true,
            child_min_age: null, child_max_age: null, child_discount_percent: null,
          }],
        };
      }

      if (text.includes('FROM package_rate_tiers')) {
        return { rows: [{ adult_unit_rate: '92.00', currency: 'USD' }] };
      }

      if (text.includes('INSERT INTO notification_outbox')) {
        log.outboxInserts += 1;
        if (script.outboxError) throw script.outboxError;
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('INSERT INTO package_reservations')) {
        log.inserts += 1;
        if (script.failInsert) throw new Error('simulated insert failure');
        const reference = (_values as string[])[0];
        return { rows: [], rowCount: 1 };
      }

      return { rows: [] };
    },
    release(reason?: unknown): void {
      log.released = true;
      log.releasedWith = reason;
    },
  } as unknown as PoolClient;

  return { client, log };
}

function useClient(script: Script = {}) {
  const { client, log } = scriptedClient(script);
  __setClientFactoryForTests(async () => client);
  return log;
}

const count = (log: Recording, prefix: string) =>
  log.statements.filter((statement) => statement.startsWith(prefix)).length;

afterEach(() => {
  __setClientFactoryForTests(null);
});

describe('A. COMMIT throws — outcome is uncertain', () => {
  it('throws the dedicated uncertainty error, not the driver error', async () => {
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(
      () => createPackageReservation(requestBody()),
      (error: unknown) => {
        assert.ok(error instanceof PackageReservationOutcomeUncertainError);
        assert.ok(!(error instanceof PackageReservationError), 'must not look like a domain refusal');
        return true;
      },
    );
  });

  it('opened a transaction, inserted once and attempted COMMIT once', async () => {
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(count(log, 'BEGIN'), 1);
    assert.equal(log.inserts, 1, 'exactly one INSERT attempt');
    assert.equal(count(log, 'COMMIT'), 1, 'exactly one COMMIT attempt');
  });

  it('issues NO ROLLBACK after the commit was attempted', async () => {
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(count(log, 'ROLLBACK'), 0,
      'a rollback here would claim the reservation was undone, which nobody knows');
  });

  it('queued the hotel event exactly once, inside the same uncertain transaction', async () => {
    // The event shares the transaction, so it shares the uncertainty. That is
    // the point: committed, not committed or unknown applies to the
    // reservation and its notification together, and it is never true that
    // one exists without the other.
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(log.outboxInserts, 1, 'exactly one outbox attempt');
    assert.ok(
      log.statements.indexOf('COMMIT') >
        log.statements.findIndex((statement) => statement.startsWith('INSERT INTO notification_outbox')),
      'the event was queued before the commit was attempted',
    );
  });

  it('does not retry the outbox insert after an uncertain commit', async () => {
    // Nothing may be re-attempted once the outcome is unknown. A second event
    // would be a second message for a booking that may already exist.
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(log.outboxInserts, 1);
  });

  it('does not retry the commit or the insert', async () => {
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(count(log, 'COMMIT'), 1);
    assert.equal(log.inserts, 1, 'retrying could create a second reservation');
  });

  it('discards the connection instead of returning it to the pool', async () => {
    const log = useClient({ failOn: 'COMMIT' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(log.released, true);
    assert.equal(log.releasedWith, true, 'release(true) poisons the connection');
  });

  it('keeps the driver error internal, as a cause', async () => {
    useClient({ failOn: 'COMMIT' });

    await assert.rejects(
      () => createPackageReservation(requestBody()),
      (error: unknown) => {
        const uncertain = error as PackageReservationOutcomeUncertainError;
        assert.equal(uncertain.message, 'PostgreSQL COMMIT did not report its outcome');
        assert.doesNotMatch(uncertain.message, /simulated failure/);
        assert.ok(uncertain.cause instanceof Error, 'cause retained for server-side diagnosis only');
        return true;
      },
    );
  });
});

describe('B. pre-COMMIT INSERT failure stays a definite failure', () => {
  it('rolls back, never commits, and does not retry', async () => {
    const log = useClient({ failInsert: true });

    await assert.rejects(() => createPackageReservation(requestBody()), (error: unknown) => {
      assert.ok(!(error instanceof PackageReservationOutcomeUncertainError),
        'a pre-commit failure is definite, never uncertain');
      return true;
    });

    assert.equal(count(log, 'BEGIN'), 1);
    assert.equal(log.inserts, 1, 'no retry');
    assert.equal(count(log, 'ROLLBACK'), 1);
    assert.equal(count(log, 'COMMIT'), 0, 'nothing may be committed after a failed write');
  });

  it('releases the connection normally when the rollback succeeds', async () => {
    const log = useClient({ failInsert: true });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(log.released, true);
    assert.notEqual(log.releasedWith, true, 'a cleanly rolled-back connection is reusable');
  });
});

describe('B2. pre-COMMIT outbox failure stays a definite failure', () => {
  /** As PostgreSQL raises a unique violation. */
  const uniqueViolation = () =>
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'notification_outbox_event_booking_key',
    });

  it('rolls back, never commits, and takes the reservation with it', async () => {
    // A strict insert that fails before COMMIT is an ordinary pre-commit
    // failure: the transaction is still open, so ending it proves neither the
    // reservation nor the event was written.
    const log = useClient({ outboxError: uniqueViolation() });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(log.inserts, 1, 'the reservation was attempted');
    assert.equal(log.outboxInserts, 1, 'the event was attempted once');
    assert.equal(count(log, 'ROLLBACK'), 1, 'the transaction was definitively ended');
    assert.equal(count(log, 'COMMIT'), 0, 'nothing may commit after a failed outbox insert');
  });

  it('propagates the original database error, object identity included', async () => {
    // Not wrapped in PackageReservationOutcomeUncertainError: this failure is
    // definite, and dressing it as uncertainty would tell the caller nobody
    // knows what happened when the rollback proved exactly what happened.
    const raised = uniqueViolation();
    useClient({ outboxError: raised });

    const thrown = await createPackageReservation(requestBody()).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, raised, 'the very same error object');
    assert.equal((thrown as { code: string }).code, '23505');
    assert.ok(
      !(thrown instanceof PackageReservationOutcomeUncertainError),
      'a definite failure must not be reported as an uncertain one',
    );
    assert.ok(!(thrown instanceof PackageReservationError), 'nor as a domain refusal');
  });

  it('releases the connection normally, since the rollback succeeded', async () => {
    // The session is describable again, so the connection is reusable. Only
    // an unanswered COMMIT or a failed ROLLBACK poisons it.
    const log = useClient({ outboxError: uniqueViolation() });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(log.released, true);
    assert.notEqual(log.releasedWith, true, 'this client is not poisoned');
  });
});

describe('C. ROLLBACK failure', () => {
  it('discards the connection', async () => {
    // The INSERT fails, and the rollback that follows fails too.
    const log = useClient({ failInsert: true, failOn: 'ROLLBACK' });

    await assert.rejects(() => createPackageReservation(requestBody()));

    assert.equal(count(log, 'ROLLBACK'), 1);
    assert.equal(log.released, true);
    assert.equal(log.releasedWith, true);
  });
});

describe('D. BEGIN failure', () => {
  it('runs no insert, no commit and no rollback, and discards the connection', async () => {
    const log = useClient({ failOn: 'BEGIN' });

    await assert.rejects(() => createPackageReservation(requestBody()), (error: unknown) => {
      assert.ok(!(error instanceof PackageReservationOutcomeUncertainError));
      return true;
    });

    assert.equal(log.inserts, 0);
    assert.equal(count(log, 'COMMIT'), 0);
    assert.equal(count(log, 'ROLLBACK'), 0, 'there is no transaction to end');
    assert.equal(log.released, true);
    assert.equal(log.releasedWith, true);
  });
});

describe('E. success', () => {
  it('runs BEGIN then the reservation work then COMMIT, with no rollback', async () => {
    const log = useClient();

    const confirmation = await createPackageReservation(requestBody());

    assert.equal(count(log, 'BEGIN'), 1);
    assert.equal(log.inserts, 1);
    assert.equal(count(log, 'COMMIT'), 1);
    assert.equal(count(log, 'ROLLBACK'), 0);
    assert.equal(confirmation.status, 'pending');
  });

  it('releases the connection normally', async () => {
    const log = useClient();

    await createPackageReservation(requestBody());

    assert.equal(log.released, true);
    assert.notEqual(log.releasedWith, true);
  });

  it('returns the existing confirmation contract unchanged', async () => {
    useClient();

    const confirmation = await createPackageReservation(requestBody());

    assert.match(confirmation.bookingReference, /^TPP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
    assert.equal(confirmation.currency, 'USD');
    assert.equal(confirmation.pricingStatus, 'quoted');
    assert.equal(confirmation.adultUnitRate, '92.00');
    assert.equal(confirmation.totalAmount, '184.00', '2 adults x 92.00, exact minor units');
    assert.deepEqual(confirmation.package, {
      code: 'T001',
      slug: 'tour-to-giza-pyramids-and-sphinx',
      title: 'Tour to Giza Pyramids and Sphinx',
    });
    assert.deepEqual(confirmation.variant, { key: 'standard', label: 'Standard' });
    assert.equal(confirmation.tourDate, TOUR_DATE);
  });
});
