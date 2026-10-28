import assert from 'node:assert/strict';
import type { PoolClient } from '../src/db/pool';
import { afterEach, before, describe, it } from 'node:test';

// The journey booking's outbox wiring, against a scripted client.
//
// What this file is about is the event itself: that one is written, on the
// booking's own connection, in the right place, carrying exactly the snapshot
// the flow already held. The transaction's fate under a failing outbox insert
// and under an unanswered COMMIT belongs with the rest of the transaction
// state machine and is proved in `package-reservations.transaction.test.ts`,
// which this file does not repeat.
//
// Scope is Event 3 only — `package_reservation_created`, to the hotel. Journey
// confirmations are not wired.
//
// The service is imported lazily behind a placeholder DATABASE_URL and driven
// through its existing client-factory seam, exactly as the transaction suite
// does. No pool, no database.

type ServiceModule = typeof import('../src/modules/package-reservations/package-reservations.service.js');

let createPackageReservation: ServiceModule['createPackageReservation'];
let __setClientFactoryForTests: ServiceModule['__setClientFactoryForTests'];

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ createPackageReservation, __setClientFactoryForTests } = await import(
    '../src/modules/package-reservations/package-reservations.service.js'
  ));
});

afterEach(() => {
  __setClientFactoryForTests(null);
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

type Recorded = { text: string; values: unknown[] };

type Recording = {
  statements: Recorded[];
  /** Every distinct client object a statement was issued on. */
  clients: Set<unknown>;
};

/** Answers the catalogue reads the service performs and records everything. */
function scriptedClient(): { client: PoolClient; log: Recording } {
  const log: Recording = { statements: [], clients: new Set() };

  const client = {
    async query(text: string, values: unknown[] = []): Promise<unknown> {
      log.statements.push({ text, values });
      log.clients.add(client);

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
            child_min_age: 3, child_max_age: 11, child_discount_percent: '50.00',
          }],
        };
      }

      if (text.includes('FROM package_rate_tiers')) {
        return { rows: [{ adult_unit_rate: '92.00', currency: 'USD' }] };
      }

      if (text.includes('INSERT INTO package_reservations')) {
        return { rows: [{ booking_reference: (values as string[])[0] }] };
      }

      if (text.includes('INSERT INTO notification_outbox')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [] };
    },
    release(): void {
      // The service decides whether to poison; nothing here needs to know.
    },
  } as unknown as PoolClient;

  return { client, log };
}

function useClient() {
  const { client, log } = scriptedClient();
  __setClientFactoryForTests(async () => client);
  return { client, log };
}

/** Statement texts in issue order, reduced to what this file cares about. */
const sequence = (log: Recording): string[] =>
  log.statements.map(({ text }) => {
    const compact = text.trim().replace(/\s+/g, ' ');

    if (compact.startsWith('INSERT INTO notification_outbox')) return 'OUTBOX';
    if (compact.startsWith('INSERT INTO package_reservations')) return 'RESERVATION';
    if (compact.startsWith('BEGIN')) return 'BEGIN';
    if (compact.startsWith('COMMIT')) return 'COMMIT';
    if (compact.startsWith('ROLLBACK')) return 'ROLLBACK';

    return 'READ';
  });

const outboxStatements = (log: Recording): Recorded[] =>
  log.statements.filter(({ text }) => text.includes('INSERT INTO notification_outbox'));

const payloadOf = (log: Recording) => JSON.parse(String(outboxStatements(log)[0]?.values[5]));

describe('journey booking queues the hotel notification', () => {
  it('writes exactly one event for a successful booking', async () => {
    const { log } = useClient();

    await createPackageReservation(requestBody());

    assert.equal(outboxStatements(log).length, 1);
  });

  it('writes it on the same client as the reservation, acquiring none of its own', async () => {
    const { client, log } = useClient();

    await createPackageReservation(requestBody());

    assert.equal(log.clients.size, 1);
    assert.equal([...log.clients][0], client);
  });

  it('places it after the reservation insert and before the COMMIT', async () => {
    const { log } = useClient();

    await createPackageReservation(requestBody());

    assert.deepEqual(sequence(log), [
      'BEGIN',
      'READ',
      'READ',
      'READ',
      'RESERVATION',
      'OUTBOX',
      'COMMIT',
    ]);
  });

  it('carries the package-created hotel identity', async () => {
    const { log } = useClient();

    const confirmation = await createPackageReservation(requestBody());
    const [eventType, bookingReference, recipientKind, recipientEmail, templateKey] =
      outboxStatements(log)[0]?.values ?? [];

    assert.equal(eventType, 'package_reservation_created');
    assert.equal(bookingReference, confirmation.bookingReference);
    assert.equal(recipientKind, 'hotel');
    assert.equal(recipientEmail, null, 'the hotel address is the dispatcher to resolve');
    assert.equal(templateKey, 'package_created_hotel.v1');
  });

  it('carries the snapshot the flow already held', async () => {
    const { log } = useClient();

    const confirmation = await createPackageReservation(
      requestBody({ specialRequests: 'Vegetarian lunch, please.' }),
    );

    assert.deepEqual(payloadOf(log), {
      bookingReference: confirmation.bookingReference,
      guestFirstName: 'Amira',
      guestLastName: 'Hassan',
      guestEmail: 'amira@example.test',
      guestPhone: '+201000000000',
      guestCountry: 'Egypt',
      packageCode: 'T001',
      packageTitle: 'Tour to Giza Pyramids and Sphinx',
      variantLabel: 'Standard',
      tourDate: TOUR_DATE,
      adults: 2,
      children: 0,
      childAges: null,
      pricingStatus: 'quoted',
      adultUnitRate: '92.00',
      childUnitRate: null,
      totalAmount: '184.00',
      currency: 'USD',
      specialRequests: 'Vegetarian lunch, please.',
    });
  });

  it('prices the payload from the same figures the guest was quoted', async () => {
    // Not recomputed and not re-read: the hotel reads what the confirmation
    // said.
    const { log } = useClient();

    const confirmation = await createPackageReservation(requestBody());
    const payload = payloadOf(log);

    assert.equal(payload.adultUnitRate, confirmation.adultUnitRate);
    assert.equal(payload.childUnitRate, confirmation.childUnitRate);
    assert.equal(payload.totalAmount, confirmation.totalAmount);
    assert.equal(payload.currency, confirmation.currency);
    assert.equal(payload.pricingStatus, confirmation.pricingStatus);
  });

  it('carries the booked variant label and package code, not their keys or ids', async () => {
    const { log } = useClient();

    await createPackageReservation(requestBody());

    const raw = String(outboxStatements(log)[0]?.values[5]);

    assert.equal(payloadOf(log).variantLabel, 'Standard');
    assert.equal(payloadOf(log).packageCode, 'T001');
    assert.ok(!raw.includes('variantKey'), 'a key is how code finds a thing');
    assert.ok(!raw.includes('packageSlug'));
    assert.ok(!raw.includes('"id"'));
  });

  it('carries child ages when children were booked', async () => {
    const { log } = useClient();

    await createPackageReservation(requestBody({ adults: 2, children: 2, childAges: [7, 11] }));
    const payload = payloadOf(log);

    assert.equal(payload.children, 2);
    assert.deepEqual(payload.childAges, [7, 11], 'in the order the guest gave them');
  });

  it('adds no read of its own to the transaction', async () => {
    // Everything was already in scope: the input, the locked catalogue
    // snapshot and the price just computed. The three reads are the
    // service's own, and there is no fourth.
    const { log } = useClient();

    await createPackageReservation(requestBody());

    assert.equal(sequence(log).filter((statement) => statement === 'READ').length, 3);
    assert.equal(log.statements.length, 7, 'BEGIN, three reads, the insert, the outbox, COMMIT');
  });
});

describe('the public confirmation is unchanged by the wiring', () => {
  it('returns exactly the fields it always did', async () => {
    useClient();

    const confirmation = await createPackageReservation(requestBody());

    assert.deepEqual(Object.keys(confirmation).sort(), [
      'adultUnitRate',
      'adults',
      'bookingReference',
      'childUnitRate',
      'children',
      'currency',
      'package',
      'pricingStatus',
      'status',
      'totalAmount',
      'tourDate',
      'variant',
    ]);
    assert.deepEqual(Object.keys(confirmation.package).sort(), ['code', 'slug', 'title']);
    assert.deepEqual(Object.keys(confirmation.variant).sort(), ['key', 'label']);
  });

  it('leaks no guest or contact data', async () => {
    // The payload carries the guest's email, phone and country because the
    // hotel needs them. None of that may follow the event into the response.
    useClient();

    const confirmation = await createPackageReservation(
      requestBody({ specialRequests: 'Vegetarian lunch, please.' }),
    );
    const serialised = JSON.stringify(confirmation);

    for (const withheld of [
      'amira@example.test',
      '+201000000000',
      'Amira',
      'Hassan',
      'Egypt',
      'Vegetarian lunch',
    ]) {
      assert.ok(!serialised.includes(withheld), `the response must not carry ${withheld}`);
    }
  });
});
