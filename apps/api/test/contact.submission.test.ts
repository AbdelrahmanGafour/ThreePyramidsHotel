import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { before, describe, it } from 'node:test';
import {
  generateContactReference,
  isContactReference,
} from '../src/modules/contact/contact-reference';

// The contact submission flow, without a database and without a network.
//
// Three things are worth proving here and are proved nowhere else: that this
// path opens no transaction (it has exactly one write, and a transaction would
// break its retry), that it retries ONLY the outbox's own uniqueness and
// propagates everything else untouched, and that nothing a visitor submitted
// comes back out in any response.

type ServiceModule = typeof import('../src/modules/contact/contact.service.js');
type PoolModule = typeof import('../src/db/pool.js');
type ControllerModule = typeof import('../src/modules/contact/contact.controller.js');

let submitContactInquiry: ServiceModule['submitContactInquiry'];
let submitContactInquiryHandler: ControllerModule['submitContactInquiryHandler'];
let dbPool: PoolModule['dbPool'];

const VALID = {
  firstName: 'Amina',
  lastName: 'Khalil',
  email: 'amina@example.test',
  phone: '+20 100 000 0000',
  inquiryType: 'Room reservation',
  message: 'Do you have a room with a view of the plateau in April?',
};

/** The real constraint, read from the migration rather than assumed. */
const OUTBOX_UNIQUE = 'notification_outbox_event_booking_key';

const uniqueViolation = (constraint = OUTBOX_UNIQUE) =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });

type Recorded = { text: string; values: unknown[] };

type Harness = { statements: Recorded[]; released: number; connects: number };

/**
 * Replaces the pool's `connect` with a recording client.
 *
 * `failures` is how many leading INSERTs should throw, and with what.
 */
function usePool(failures: unknown[] = []): Harness {
  const harness: Harness = { statements: [], released: 0, connects: 0 };
  let inserts = 0;

  (dbPool as unknown as { connect: unknown }).connect = async () => {
    harness.connects += 1;

    return {
      async query(text: string, values: unknown[] = []) {
        harness.statements.push({ text, values });

        if (text.includes('INSERT INTO notification_outbox')) {
          const failure = failures[inserts];
          inserts += 1;

          if (failure) {
            throw failure;
          }
        }

        return { rows: [], rowCount: 1 };
      },
      release() {
        harness.released += 1;
      },
    };
  };

  return harness;
}

const outboxInserts = (harness: Harness) =>
  harness.statements.filter((statement) => statement.text.includes('INSERT INTO notification_outbox'));

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  ({ dbPool } = await import('../src/db/pool.js'));
  ({ submitContactInquiry } = await import('../src/modules/contact/contact.service.js'));
  ({ submitContactInquiryHandler } = await import(
    '../src/modules/contact/contact.controller.js'
  ));
});

describe('the contact reference', () => {
  it('has the contact prefix and a twelve-character token', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      assert.match(generateContactReference(), /^TPC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
    }
  });

  it('never emits a character that can be misread', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      assert.doesNotMatch(generateContactReference(), /[0O1I]/);
    }
  });

  it('produces references its own validator accepts', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const reference = generateContactReference();

      assert.ok(isContactReference(reference), `generated an unrecognised reference: ${reference}`);
    }
  });

  it('does not accept a room or journey reference', () => {
    // The prefix is the identity: sharing an alphabet is not sharing a kind.
    assert.equal(isContactReference('TPH-A2B3C4D5E6F7'), false);
    assert.equal(isContactReference('TPP-A2B3C4D5E6F7'), false);
    assert.equal(isContactReference('tpc-a2b3c4d5e6f7'), false);
    assert.equal(isContactReference(' TPC-A2B3C4D5E6F7'), false);
    assert.equal(isContactReference(42), false);
  });

  it('is not predictable from a previous one', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateContactReference()));

    assert.equal(seen.size, 500, 'no repeats across 500 references');
  });
});

describe('submitting an inquiry', () => {
  it('writes exactly one outbox row', async () => {
    const harness = usePool();

    await submitContactInquiry(VALID);

    assert.equal(outboxInserts(harness).length, 1);
    assert.equal(harness.connects, 1, 'one connection for one write');
  });

  it('opens no transaction', async () => {
    // One statement is already atomic, and a transaction would break the
    // retry below: a strict insert that raises inside one aborts everything
    // after it.
    const harness = usePool();

    await submitContactInquiry(VALID);

    for (const { text } of harness.statements) {
      assert.doesNotMatch(text, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i);
    }
    assert.equal(harness.statements.length, 1, 'the insert, and nothing else');
  });

  it('queues a contact event addressed to the hotel', async () => {
    const harness = usePool();

    await submitContactInquiry(VALID);

    const [eventType, bookingReference, recipientKind, recipientEmail, templateKey, payload] =
      outboxInserts(harness)[0]?.values ?? [];

    assert.equal(eventType, 'contact_inquiry_received');
    assert.ok(isContactReference(bookingReference), 'the internal TPC reference');
    assert.equal(recipientKind, 'hotel');
    assert.equal(recipientEmail, null, 'there is no autoresponder');
    assert.equal(templateKey, 'contact_received_hotel.v1');
    assert.deepEqual(JSON.parse(String(payload)), {
      reference: bookingReference,
      firstName: 'Amina',
      lastName: 'Khalil',
      email: 'amina@example.test',
      phone: '+20 100 000 0000',
      inquiryType: 'Room reservation',
      message: 'Do you have a room with a view of the plateau in April?',
    });
  });

  it('stores the trimmed values the validator produced', async () => {
    const harness = usePool();

    await submitContactInquiry({ ...VALID, firstName: '  Amina  ', message: '  Hello.  ' });

    const payload = JSON.parse(String(outboxInserts(harness)[0]?.values[5]));
    assert.equal(payload.firstName, 'Amina');
    assert.equal(payload.message, 'Hello.');
  });

  it('returns only an acknowledgement', async () => {
    usePool();

    const result = await submitContactInquiry(VALID);

    assert.deepEqual(result, { received: true });
    assert.equal(JSON.stringify(result).includes('TPC-'), false, 'the reference stays internal');
  });

  it('releases the client', async () => {
    const harness = usePool();

    await submitContactInquiry(VALID);

    assert.equal(harness.released, 1);
  });

  it('makes no provider or network call', async () => {
    const harness = usePool();

    await submitContactInquiry(VALID);

    // The only thing this flow does is one INSERT. Delivery is the
    // dispatcher's, so a slow provider cannot make a submission hang.
    assert.equal(harness.statements.length, 1);
    assert.equal(
      harness.statements.some((statement) => statement.text.includes('resend')),
      false,
    );
  });
});

describe('reference collisions', () => {
  it('retries with a fresh reference and succeeds', async () => {
    const harness = usePool([uniqueViolation()]);

    const result = await submitContactInquiry(VALID);

    assert.deepEqual(result, { received: true });

    const inserts = outboxInserts(harness);
    assert.equal(inserts.length, 2, 'one collision, one retry');
    assert.notEqual(inserts[0]?.values[1], inserts[1]?.values[1], 'and a different reference');
    assert.equal(harness.released, 1, 'still one connection, released once');
  });

  it('gives up after five attempts', async () => {
    const harness = usePool(Array.from({ length: 5 }, () => uniqueViolation()));

    await assert.rejects(
      () => submitContactInquiry(VALID),
      /Could not generate a unique contact reference after 5 attempts/,
    );

    assert.equal(outboxInserts(harness).length, 5, 'exactly five, matching the room flow');
    assert.equal(harness.released, 1);
  });

  it('retries only the outbox uniqueness, not any unique violation', async () => {
    // A bare 23505 check would swallow a violation on some column added later
    // and retry something a new reference cannot fix.
    const other = uniqueViolation('notification_outbox_some_future_key');
    const harness = usePool([other]);

    const thrown = await submitContactInquiry(VALID).then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(thrown, other, 'the very same error object');
    assert.equal(outboxInserts(harness).length, 1, 'and no retry');
    assert.equal(harness.released, 1);
  });

  it('propagates an unrelated database error unchanged', async () => {
    for (const failure of [
      Object.assign(new Error('check violation'), { code: '23514', constraint: 'x_check' }),
      Object.assign(new Error('connection terminated'), { code: '08006' }),
      new Error('something else entirely'),
    ]) {
      const harness = usePool([failure]);

      const thrown = await submitContactInquiry(VALID).then(
        () => null,
        (error: unknown) => error,
      );

      assert.equal(thrown, failure, 'propagated by identity');
      assert.equal(outboxInserts(harness).length, 1, 'no retry');
      assert.equal(harness.released, 1, 'and the client is still released');
    }
  });
});

describe('a refused inquiry never reaches the database', () => {
  it('rejects invalid input before connecting', async () => {
    const harness = usePool();

    await assert.rejects(() => submitContactInquiry({ ...VALID, email: 'nope' }));

    assert.equal(harness.connects, 0, 'no connection was taken');
    assert.equal(harness.statements.length, 0);
  });

  it('rejects a populated honeypot before connecting', async () => {
    const harness = usePool();

    await assert.rejects(() => submitContactInquiry({ ...VALID, website: 'http://spam.example' }));

    assert.equal(harness.connects, 0);
  });
});

/** Captures what a handler wrote, without an HTTP server. */
function capture(): { res: Response; status: () => number | undefined; body: () => unknown } {
  let status: number | undefined;
  let body: unknown;

  const res = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as Response;

  return { res, status: () => status, body: () => body };
}

const request = (body: unknown) => ({ body }) as Request;

describe('the HTTP contract', () => {
  it('answers 202 with exactly an acknowledgement', async () => {
    usePool();
    const captured = capture();

    await submitContactInquiryHandler(request(VALID), captured.res);

    // 202, not 201: nothing was created that the visitor can address, and the
    // email has not been sent yet.
    assert.equal(captured.status(), 202);
    assert.deepEqual(captured.body(), { data: { received: true } });
  });

  it('echoes nothing the visitor submitted', async () => {
    usePool();
    const captured = capture();

    await submitContactInquiryHandler(request(VALID), captured.res);

    const serialised = JSON.stringify(captured.body());
    for (const withheld of [
      'TPC-',
      'Amina',
      'Khalil',
      'amina@example.test',
      '+20 100 000 0000',
      'Room reservation',
      'plateau',
    ]) {
      assert.equal(serialised.includes(withheld), false, `the response must not carry ${withheld}`);
    }
  });

  it('answers 400 for an invalid inquiry', async () => {
    usePool();
    const captured = capture();

    await submitContactInquiryHandler(
      request({ ...VALID, message: '' }),
      captured.res,
    );

    assert.equal(captured.status(), 400);
    assert.deepEqual(Object.keys(captured.body() as object), ['error']);
    assert.equal(
      (captured.body() as { error: { code: string } }).error.code,
      'INVALID_CONTACT_INQUIRY',
    );
  });

  it('answers a populated honeypot identically to any other refusal', async () => {
    // Byte-identical, so a bot learns nothing about which rule caught it.
    usePool();
    const trapped = capture();
    const ordinary = capture();

    await submitContactInquiryHandler(
      request({ ...VALID, website: 'http://spam.example' }),
      trapped.res,
    );
    await submitContactInquiryHandler(
      request({ ...VALID, firstName: '' }),
      ordinary.res,
    );

    assert.equal(trapped.status(), ordinary.status());
    assert.equal(JSON.stringify(trapped.body()), JSON.stringify(ordinary.body()));

    const serialised = JSON.stringify(trapped.body()).toLowerCase();
    for (const word of ['honeypot', 'spam', 'bot']) {
      assert.equal(serialised.includes(word), false, `must not mention ${word}`);
    }
  });

  it('sanitises an unexpected failure into a fixed 500', async () => {
    usePool([
      Object.assign(new Error('relation "notification_outbox" does not exist'), {
        code: '42P01',
        constraint: 'secret_constraint_name',
      }),
    ]);
    const captured = capture();

    await submitContactInquiryHandler(request(VALID), captured.res);

    assert.equal(captured.status(), 500);
    assert.deepEqual(captured.body(), {
      error: { code: 'CONTACT_INQUIRY_FAILED', message: 'Your inquiry could not be submitted' },
    });

    const serialised = JSON.stringify(captured.body());
    for (const leak of ['42P01', 'notification_outbox', 'secret_constraint_name', 'relation']) {
      assert.equal(serialised.includes(leak), false, `must not leak ${leak}`);
    }
  });
});
