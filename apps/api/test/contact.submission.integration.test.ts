import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// One contact submission, against real MySQL.
//
// Small on purpose. The validator, the event, the template and the retry are
// each covered in their own unit suites; the only questions here are the ones
// a stub cannot settle: that the row the service writes is actually accepted
// by the outbox's constraints, that it lands queued rather than sent, and that
// nothing else is created — there is no contact table, and this proves it.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the integration tests. Run them from a shell that has it set, e.g.\n' +
      '  npm run test:integration -w apps/api',
  );
}

type Pool = typeof import('../src/db/pool.js');
type ServiceModule = typeof import('../src/modules/contact/contact.service.js');

let dbPool: Pool['dbPool'];
let closeDatabasePool: Pool['closeDatabasePool'];
let submitContactInquiry: ServiceModule['submitContactInquiry'];

/**
 * Unique to this run, and carried in the MESSAGE rather than the reference.
 *
 * The reference is generated inside the service and never returned, so this
 * suite cannot know it in advance. Tagging the message is what lets cleanup
 * find exactly the rows this run created and nothing else.
 */
const runTag = `ITEST-CONTACT-SUBMIT-${Math.random().toString(36).slice(2, 10)}`;

const inquiry = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Amina',
  lastName: 'Khalil',
  email: 'amina@example.test',
  phone: '+20 100 000 0000',
  inquiryType: 'Room reservation',
  message: `${runTag} Do you have a room with a view of the plateau in April?`,
  ...overrides,
});

/** Every outbox row this run created, found by its tagged message. */
const rowsForThisRun = async () =>
  (
    await dbPool.query(
      `SELECT booking_reference, event_type, recipient_kind, recipient_email, template_key,
              payload, attempts, accepted_at, failed_at, resolved_from, resolved_to, created_at
         FROM notification_outbox
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message')) LIKE $1
        ORDER BY id`,
      [`${runTag}%`],
    )
  ).rows;

before(async () => {
  ({ dbPool, closeDatabasePool } = await import('../src/db/pool.js'));

  // The schema (src/db/schema) is applied beforehand with `npm run migrate:up`.

  ({ submitContactInquiry } = await import('../src/modules/contact/contact.service.js'));
});

after(async () => {
  try {
    // Scoped to this run's own rows, found by the tag in their payload. Never
    // a sweep of the table: other suites have rows here they assert on.
    await dbPool.query(`DELETE FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message')) LIKE $1`, [
      `${runTag}%`,
    ]);

    assert.deepEqual(await rowsForThisRun(), [], 'this run left rows behind');
  } finally {
    await closeDatabasePool();
  }
});

describe('submitting a contact inquiry against MySQL', () => {
  it('creates exactly one queued contact event and nothing else', async () => {
    const result = await submitContactInquiry(inquiry());

    assert.deepEqual(result, { received: true }, 'the visitor learns only that it was received');

    const rows = await rowsForThisRun();
    assert.equal(rows.length, 1, 'one submission, one row');

    const row = rows[0];
    assert.equal(row.event_type, 'contact_inquiry_received');
    assert.equal(row.template_key, 'contact_received_hotel.v1');
    assert.match(row.booking_reference, /^TPC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);

    // Hotel-bound, with no recipient: there is no visitor autoresponder, and
    // the hotel's address is the dispatcher's to resolve at claim time.
    assert.equal(row.recipient_kind, 'hotel');
    assert.equal(row.recipient_email, null);

    // Queued, not sent. Nothing in the request path touches a provider.
    assert.equal(row.attempts, 0);
    assert.equal(row.accepted_at, null);
    assert.equal(row.failed_at, null);
    assert.equal(row.resolved_from, null, 'the envelope is resolved on first claim');
    assert.equal(row.resolved_to, null);
    assert.ok(row.created_at instanceof Date);
  });

  it('stores the validated payload, and the reference it is keyed by', async () => {
    await submitContactInquiry(
      inquiry({ firstName: '  Tomas  ', lastName: 'Novak', inquiryType: 'Airport transfer' }),
    );

    const row = (await rowsForThisRun()).at(-1);
    assert.ok(row, 'the row exists');

    assert.equal(row.payload.reference, row.booking_reference, 'both copies agree');
    assert.equal(row.payload.firstName, 'Tomas', 'the trimmed value the validator produced');
    assert.equal(row.payload.lastName, 'Novak');
    assert.equal(row.payload.email, 'amina@example.test');
    assert.equal(row.payload.phone, '+20 100 000 0000');
    assert.equal(row.payload.inquiryType, 'Airport transfer');
    assert.ok(String(row.payload.message).startsWith(runTag));

    assert.deepEqual(Object.keys(row.payload).sort(), [
      'email',
      'firstName',
      'inquiryType',
      'lastName',
      'message',
      'phone',
      'reference',
    ]);
  });

  it('stores a missing phone as null rather than an empty string', async () => {
    await submitContactInquiry(inquiry({ phone: undefined }));

    const row = (await rowsForThisRun()).at(-1);

    assert.equal(row?.payload.phone, null);
  });

  it('creates no business row anywhere, because there is no contact table', async () => {
    // The architecture in one assertion: the outbox row IS the inquiry.
    const { rows } = await dbPool.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'contact_inquiries'`,
    );

    assert.equal(Number(rows[0]?.total), 0, 'no contact_inquiries table exists');
  });

  it('gives each submission its own reference', async () => {
    const before = (await rowsForThisRun()).length;

    await submitContactInquiry(inquiry());
    await submitContactInquiry(inquiry());

    const rows = await rowsForThisRun();
    assert.equal(rows.length, before + 2);

    const references = rows.map((row) => row.booking_reference);
    assert.equal(new Set(references).size, references.length, 'every reference is distinct');
  });

  it('refuses an invalid inquiry without writing anything', async () => {
    const before = (await rowsForThisRun()).length;

    await assert.rejects(() => submitContactInquiry(inquiry({ email: 'not-an-email' })));
    await assert.rejects(() => submitContactInquiry(inquiry({ website: 'http://spam.example' })));

    assert.equal((await rowsForThisRun()).length, before, 'nothing was written');
  });
});
