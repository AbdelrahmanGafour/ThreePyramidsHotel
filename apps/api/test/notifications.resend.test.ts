import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sendNotificationEmail,
  type FetchLike,
  type ProviderResult,
  type SendNotificationEmailInput,
} from '../src/modules/notifications/notifications.resend';

// The Resend adapter, with fetch injected.
//
// No network and no global patching: `sendNotificationEmail` takes its fetch as
// a parameter, so every case below is an ordinary function call.
//
// Two things are under test. The request must be a pure function of the input —
// byte-identical across retries, or the shared idempotency key turns a
// legitimate retry into a rejected conflicting replay. And every response must
// land on the right pair of axes, because `acceptance` is the durable half that
// somebody reads months later when deciding whether resending a confirmation
// would double-send it to a guest.

const API_KEY = 're_test_0123456789abcdef';

const INPUT: SendNotificationEmailInput = {
  apiKey: API_KEY,
  eventType: 'room_reservation_confirmed',
  bookingReference: 'TPH-A2B3C4D5E6F7',
  resolvedFrom: 'Three Pyramids <stay@example.test>',
  resolvedTo: 'guest@example.test',
  subject: 'Your reservation is confirmed: TPH-A2B3C4D5E6F7',
  html: '<!DOCTYPE html><html><body><p>Confirmed</p></body></html>',
  text: 'Your reservation is confirmed\n',
  timeoutMs: 8000,
};

type Call = { url: string; init: RequestInit };

/** A fetch that records its call and answers with the given response. */
function stubFetch(response: { status: number; body?: unknown; raw?: string }): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];

  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      async json() {
        if (response.raw !== undefined) {
          // Stands in for HTML or an empty body from a gateway: `json()` throws.
          return JSON.parse(response.raw) as unknown;
        }
        return response.body;
      },
    } as unknown as Response;
  };

  return { fetch, calls };
}

/** A fetch that fails the way the network does. */
function failingFetch(error: unknown): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];

  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    throw error;
  };

  return { fetch, calls };
}

const accepted = () => stubFetch({ status: 200, body: { id: 'msg_abc123' } });

const headersOf = (call: Call): Record<string, string> =>
  (call.init.headers ?? {}) as Record<string, string>;

/** Sends against an error response and returns the failure. */
async function failWith(
  status: number,
  body: unknown,
  input: SendNotificationEmailInput = INPUT,
): Promise<Extract<ProviderResult, { acceptance: unknown }>> {
  const { fetch } = stubFetch({ status, body });
  const result = await sendNotificationEmail(input, fetch);

  assert.notEqual(result.outcome, 'accepted', `expected ${status} to fail`);

  return result as Extract<ProviderResult, { acceptance: unknown }>;
}

describe('the request it builds', () => {
  it('POSTs to the Resend emails endpoint', async () => {
    const { fetch, calls } = accepted();

    await sendNotificationEmail(INPUT, fetch);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.resend.com/emails');
    assert.equal(calls[0]?.init.method, 'POST');
  });

  it('sends exactly the three headers, with the pinned idempotency key', async () => {
    const { fetch, calls } = accepted();

    await sendNotificationEmail(INPUT, fetch);

    assert.deepEqual(headersOf(calls[0] as Call), {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'room_reservation_confirmed:TPH-A2B3C4D5E6F7',
    });
  });

  it('sends exactly the five body fields, in a fixed order', async () => {
    const { fetch, calls } = accepted();

    await sendNotificationEmail(INPUT, fetch);

    const body = String(calls[0]?.init.body);

    assert.equal(
      body,
      JSON.stringify({
        from: INPUT.resolvedFrom,
        to: INPUT.resolvedTo,
        subject: INPUT.subject,
        html: INPUT.html,
        text: INPUT.text,
      }),
      'byte-identical, including key order',
    );
    assert.deepEqual(Object.keys(JSON.parse(body)), ['from', 'to', 'subject', 'html', 'text']);
  });

  it('uses the frozen envelope exactly as supplied', async () => {
    const { fetch, calls } = accepted();

    await sendNotificationEmail(INPUT, fetch);

    const parsed = JSON.parse(String(calls[0]?.init.body));
    assert.equal(parsed.from, 'Three Pyramids <stay@example.test>', 'not normalised or rewritten');
    assert.equal(parsed.to, 'guest@example.test');
  });

  it('does not mutate the input it was given', async () => {
    const { fetch } = accepted();
    const before = JSON.stringify(INPUT);

    await sendNotificationEmail(INPUT, fetch);

    assert.equal(JSON.stringify(INPUT), before);
  });

  it('builds an identical request and key every time', async () => {
    // The guarantee the shared idempotency key rests on: the same key with a
    // different payload is refused as a conflicting replay.
    const first = accepted();
    const second = accepted();

    await sendNotificationEmail(INPUT, first.fetch);
    await sendNotificationEmail(INPUT, second.fetch);

    assert.equal(String(second.calls[0]?.init.body), String(first.calls[0]?.init.body));
    assert.deepEqual(headersOf(second.calls[0] as Call), headersOf(first.calls[0] as Call));
  });

  it('passes an abort signal for the caller-supplied timeout', async () => {
    const { fetch, calls } = accepted();

    await sendNotificationEmail(INPUT, fetch);

    assert.ok(calls[0]?.init.signal, 'a timeout signal was supplied');
  });

  it('issues exactly one request, on every outcome', async () => {
    // No retry loop. A retry needs the row's attempt count and the dispatcher's
    // policy, and an adapter that retried quietly would spend a budget nobody
    // recorded.
    for (const stub of [
      accepted(),
      stubFetch({ status: 500, body: { name: 'application_error' } }),
      stubFetch({ status: 429, body: { name: 'rate_limit_exceeded' } }),
      stubFetch({ status: 422, body: { name: 'validation_error' } }),
    ]) {
      await sendNotificationEmail(INPUT, stub.fetch);

      assert.equal(stub.calls.length, 1);
    }
  });
});

describe('acceptance', () => {
  it('returns the provider id on a 2xx that carries one', async () => {
    const { fetch } = accepted();

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.deepEqual(result, { outcome: 'accepted', providerReference: 'msg_abc123' });
  });

  it('treats a 2xx without a usable id as unknown, never as accepted', async () => {
    // The provider answered success, so claiming rejection would be a lie —
    // but there is no reference to store, so claiming acceptance would be too.
    for (const body of [{}, { id: '' }, { id: '   ' }, { id: 42 }, { message: 'ok' }, null, 'plain text']) {
      const { fetch } = stubFetch({ status: 200, body });

      const result = await sendNotificationEmail(INPUT, fetch);

      assert.notEqual(result.outcome, 'accepted', `${JSON.stringify(body)} is not an acceptance`);
      assert.equal((result as { acceptance: string }).acceptance, 'unknown');
      assert.equal((result as { outcome: string }).outcome, 'transient');
    }
  });

  it('does not describe acceptance as delivery anywhere in its result', async () => {
    const { fetch } = accepted();

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.equal(JSON.stringify(result).includes('delivered'), false, 'an acceptance is not a delivery');
    assert.equal(JSON.stringify(result).includes('sent'), false, 'nor a send');
  });
});

describe('the request never arrived', () => {
  it('maps a timeout to transient and unknown', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const { fetch, calls } = failingFetch(timeout);

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.deepEqual(result, {
      outcome: 'transient',
      acceptance: 'unknown',
      reason: 'The request to the email provider timed out after 8000ms',
    });
    assert.equal(calls.length, 1, 'and does not try again');
  });

  it('maps an AbortError the same way', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { fetch } = failingFetch(aborted);

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.equal((result as { outcome: string }).outcome, 'transient');
    assert.equal((result as { acceptance: string }).acceptance, 'unknown');
  });

  it('maps any network failure to transient and unknown', async () => {
    // It may have reached the provider and been accepted before the connection
    // died. Nothing may be concluded.
    const { fetch } = failingFetch(new TypeError('fetch failed'));

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.deepEqual(result, {
      outcome: 'transient',
      acceptance: 'unknown',
      reason: 'The email provider could not be reached',
    });
  });

  it('does not leak the failure object into the reason', async () => {
    const { fetch } = failingFetch(new TypeError(`connect ECONNREFUSED with ${API_KEY}`));

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.equal((result as { reason: string }).reason.includes(API_KEY), false, 'the key must never reach a reason');
  });
});

describe('server-side failures are ambiguous', () => {
  it('maps 500 application_error to transient and unknown', async () => {
    const failure = await failWith(500, { name: 'application_error', message: 'Something went wrong' });

    assert.equal(failure.outcome, 'transient');
    assert.equal(failure.acceptance, 'unknown');
    assert.equal(failure.status, 500);
    assert.equal(failure.providerCode, 'application_error');
  });

  it('maps 503 service_unavailable to transient and unknown', async () => {
    const failure = await failWith(503, { name: 'service_unavailable', message: 'Try later' });

    assert.equal(failure.outcome, 'transient');
    assert.equal(failure.acceptance, 'unknown');
    assert.equal(failure.status, 503);
  });

  it('maps any other 5xx to transient and unknown', async () => {
    for (const status of [502, 504, 599]) {
      const failure = await failWith(status, { name: 'whatever' });

      assert.equal(failure.outcome, 'transient');
      assert.equal(failure.acceptance, 'unknown', `${status} must fail closed`);
    }
  });
});

describe('idempotency conflicts', () => {
  it('maps 409 concurrent_idempotent_requests to transient and unknown', async () => {
    // Another request with this key is in flight — very likely this row's own
    // previous attempt, which may yet be accepted.
    const failure = await failWith(409, { name: 'concurrent_idempotent_requests' });

    assert.equal(failure.outcome, 'transient');
    assert.equal(failure.acceptance, 'unknown');
  });

  it('maps 409 invalid_idempotent_request to permanent and unknown', async () => {
    // This key was used with a different payload. Retrying is refused
    // identically, but the original request may well have been accepted.
    const failure = await failWith(409, { name: 'invalid_idempotent_request' });

    assert.equal(failure.outcome, 'permanent');
    assert.equal(failure.acceptance, 'unknown');
  });

  it('fails closed on an unrecognised 409', async () => {
    const failure = await failWith(409, { name: 'something_new' });

    assert.equal(failure.acceptance, 'unknown');
  });

  it('maps 400 invalid_idempotency_key to permanent and rejected', async () => {
    const failure = await failWith(400, { name: 'invalid_idempotency_key', message: 'Key too long' });

    assert.equal(failure.outcome, 'permanent');
    assert.equal(failure.acceptance, 'rejected');
    assert.equal(failure.providerCode, 'invalid_idempotency_key');
  });
});

describe('authentication and account state block the whole queue', () => {
  it('maps 401 to blocked and rejected', async () => {
    const failure = await failWith(401, { name: 'missing_api_key', message: 'Missing API key' });

    assert.equal(failure.outcome, 'blocked');
    assert.equal(failure.acceptance, 'rejected');
  });

  it('maps a 403 account restriction to blocked and rejected', async () => {
    const failure = await failWith(403, { name: 'restricted_api_key', message: 'This key is restricted' });

    assert.equal(failure.outcome, 'blocked');
    assert.equal(failure.acceptance, 'rejected');
  });

  it('maps an unverified sending domain to blocked and rejected on 403 and 422', async () => {
    for (const status of [403, 422]) {
      const failure = await failWith(status, {
        name: 'validation_error',
        message: 'The example.test domain is not verified. Please verify a domain first.',
      });

      assert.equal(failure.outcome, 'blocked', `${status} domain verification needs a human`);
      assert.equal(failure.acceptance, 'rejected');
    }
  });
});

describe('rate limits and quotas', () => {
  it('maps 429 rate_limit to transient and rejected', async () => {
    // Refused outright, so nothing was sent — but worth trying again shortly.
    const failure = await failWith(429, { name: 'rate_limit_exceeded', message: 'Too many requests' });

    assert.equal(failure.outcome, 'transient');
    assert.equal(failure.acceptance, 'rejected');
  });

  it('maps an exhausted quota to blocked and rejected', async () => {
    // A daily or monthly allowance does not clear on a retry timescale.
    const failure = await failWith(429, {
      name: 'daily_quota_exceeded',
      message: 'You have reached your daily quota',
    });

    assert.equal(failure.outcome, 'blocked');
    assert.equal(failure.acceptance, 'rejected');
  });
});

describe('validation refusals are permanent', () => {
  it('maps 422 validation errors to permanent and rejected', async () => {
    const failure = await failWith(422, { name: 'validation_error', message: 'subject is required' });

    assert.equal(failure.outcome, 'permanent');
    assert.equal(failure.acceptance, 'rejected');
  });

  it('maps an invalid address to permanent and rejected', async () => {
    const failure = await failWith(422, {
      name: 'invalid_to_address',
      message: 'The to address is invalid',
    });

    assert.equal(failure.outcome, 'permanent');
    assert.equal(failure.acceptance, 'rejected');
  });

  it('maps 404 and 405 to permanent and rejected', async () => {
    for (const status of [404, 405]) {
      const failure = await failWith(status, { name: status === 404 ? 'not_found' : 'method_not_allowed' });

      assert.equal(failure.outcome, 'permanent');
      assert.equal(failure.acceptance, 'rejected');
    }
  });
});

describe('unreadable and unrecognised responses fail closed', () => {
  it('survives a non-JSON error body and keeps the status', async () => {
    const { fetch } = stubFetch({ status: 502, raw: '<html>Bad Gateway</html>' });

    const result = await sendNotificationEmail(INPUT, fetch);

    assert.equal((result as { status: number }).status, 502);
    assert.equal((result as { acceptance: string }).acceptance, 'unknown');
    assert.equal('providerCode' in result, false, 'no code was invented');
  });

  it('survives an error body that is not an object', async () => {
    for (const body of [null, 'nope', 42, ['a']]) {
      const { fetch } = stubFetch({ status: 422, body });

      const result = await sendNotificationEmail(INPUT, fetch);

      assert.equal((result as { status: number }).status, 422, `${JSON.stringify(body)} kept its status`);
      assert.match((result as { reason: string }).reason, /no provider message/);
      // Nothing was recognisable, so nothing may be concluded.
      assert.equal((result as { acceptance: string }).acceptance, 'unknown');
    }
  });

  it('fails closed on a status it does not recognise', async () => {
    for (const status of [418, 300, 451]) {
      const failure = await failWith(status, { name: 'mystery' });

      assert.equal(failure.acceptance, 'unknown', `${status} must not claim rejection`);
      assert.equal(failure.outcome, 'transient');
    }
  });

  it('reads a nested error object as well as a flat one', async () => {
    const failure = await failWith(422, { error: { name: 'validation_error', message: 'bad field' } });

    assert.equal(failure.providerCode, 'validation_error');
  });
});

describe('unrecognised 4xx never claims rejection', () => {
  // The locked rule: `rejected` is returned only for the cases named
  // explicitly, and is never inferred from an HTTP status class. Resend can
  // add a code tomorrow that means something WAS queued, and a mapping that
  // guessed from the status would quietly record it as "no message exists".

  const unrecognised: ReadonlyArray<{ readonly status: number; readonly body: unknown }> = [
    { status: 400, body: { name: 'some_new_bad_request', message: 'unfamiliar' } },
    { status: 403, body: { name: 'some_new_forbidden', message: 'unfamiliar' } },
    { status: 422, body: { name: 'some_new_unprocessable', message: 'unfamiliar' } },
    { status: 429, body: { name: 'some_new_throttle', message: 'unfamiliar' } },
  ];

  for (const { status, body } of unrecognised) {
    it(`treats an unrecognised ${status} as transient and unknown`, async () => {
      const failure = await failWith(status, body);

      assert.equal(failure.outcome, 'transient', `${status} must stay retryable`);
      assert.equal(failure.acceptance, 'unknown', `${status} must not claim rejection`);
      assert.equal(failure.status, status, 'and must keep the status');
    });
  }

  it('does not upgrade a 4xx to rejected just because the body is unreadable', async () => {
    // With no code and no message there is nothing to recognise, so only the
    // three statuses that are definitive on their own may say `rejected`.
    for (const status of [400, 403, 422, 429]) {
      const { fetch } = stubFetch({ status, raw: '<html>Gateway</html>' });

      const result = await sendNotificationEmail(INPUT, fetch);

      assert.equal(
        (result as { acceptance: string }).acceptance,
        'unknown',
        `a malformed ${status} body proves nothing`,
      );
      assert.equal((result as { status: number }).status, status);
    }
  });

  it('still trusts the three statuses that are definitive on their own', async () => {
    // 401, 404 and 405 all mean the request never reached message handling,
    // so they stay `rejected` even with no readable body at all.
    const expected = [
      { status: 401, outcome: 'blocked' },
      { status: 404, outcome: 'permanent' },
      { status: 405, outcome: 'permanent' },
    ];

    for (const { status, outcome } of expected) {
      const { fetch } = stubFetch({ status, raw: 'not json at all' });

      const result = await sendNotificationEmail(INPUT, fetch);

      assert.equal((result as { acceptance: string }).acceptance, 'rejected', `${status} is definitive`);
      assert.equal((result as { outcome: string }).outcome, outcome);
    }
  });

  it('distinguishes a quota from a rate limit even when both say "limit"', async () => {
    // "daily limit reached" is both phrases at once, and only one of the two
    // clears on a retry timescale.
    const quota = await failWith(429, { name: 'daily_quota_exceeded', message: 'daily limit reached' });
    assert.equal(quota.outcome, 'blocked');
    assert.equal(quota.acceptance, 'rejected');

    const rateLimit = await failWith(429, { name: 'rate_limit_exceeded', message: 'rate limit reached' });
    assert.equal(rateLimit.outcome, 'transient');
    assert.equal(rateLimit.acceptance, 'rejected');
  });

  it('recognises an account restriction and an unverified domain separately on 403', async () => {
    const suspended = await failWith(403, { name: 'security_error', message: 'This account is suspended' });
    assert.equal(suspended.outcome, 'blocked');
    assert.equal(suspended.acceptance, 'rejected');

    const unverified = await failWith(403, {
      name: 'validation_error',
      message: 'The domain is not verified',
    });
    assert.equal(unverified.outcome, 'blocked');
    assert.equal(unverified.acceptance, 'rejected');
  });

  it('keeps an unrecognised 400 apart from invalid_idempotency_key', async () => {
    const known = await failWith(400, { name: 'invalid_idempotency_key', message: 'Key too long' });
    assert.equal(known.outcome, 'permanent');
    assert.equal(known.acceptance, 'rejected');

    const unknown = await failWith(400, { name: 'unexpected', message: 'Something else' });
    assert.equal(unknown.outcome, 'transient');
    assert.equal(unknown.acceptance, 'unknown');
  });
});

describe('nothing sensitive comes back out', () => {
  it('never returns the API key, however the provider phrased it', async () => {
    const failure = await failWith(401, {
      name: 'invalid_api_key',
      message: `API key ${API_KEY} is not valid`,
    });

    assert.equal(failure.reason.includes(API_KEY), false, 'the key was redacted');
    assert.match(failure.reason, /\[redacted-key\]/);
  });

  it('redacts a guest address the provider quoted back', async () => {
    // `invalid_to_address` genuinely quotes the address, so this is the normal
    // path and not defensive padding.
    const failure = await failWith(422, {
      name: 'invalid_to_address',
      message: 'guest@example.test is not a valid recipient',
    });

    assert.equal(failure.reason.includes('guest@example.test'), false, 'the address was redacted');
    assert.match(failure.reason, /\[redacted-email\]/);
  });

  it('never returns the request body or the html it sent', async () => {
    const failure = await failWith(422, { name: 'validation_error', message: 'bad payload' });

    assert.equal(failure.reason.includes('<!DOCTYPE'), false, 'the rendered html must not come back');
    assert.equal(failure.reason.includes('Authorization'), false, 'nor the authorization header');
    assert.equal(failure.reason.includes('Bearer'), false, 'nor the bearer token');
  });

  it('caps a provider message that runs long', async () => {
    const failure = await failWith(422, { name: 'validation_error', message: 'x'.repeat(5000) });

    assert.ok(failure.reason.length < 300, `reason was ${failure.reason.length} characters`);
  });
});

describe('invalid local arguments never reach the network', () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly patch: Partial<SendNotificationEmailInput>;
    readonly outcome: string;
  }> = [
    { label: 'an empty api key', patch: { apiKey: '' }, outcome: 'blocked' },
    { label: 'a blank api key', patch: { apiKey: '   ' }, outcome: 'blocked' },
    { label: 'an empty sender', patch: { resolvedFrom: '' }, outcome: 'permanent' },
    { label: 'an empty recipient', patch: { resolvedTo: '' }, outcome: 'permanent' },
    { label: 'a missing event type', patch: { eventType: '' }, outcome: 'permanent' },
    { label: 'a missing booking reference', patch: { bookingReference: '' }, outcome: 'permanent' },
    { label: 'a zero timeout', patch: { timeoutMs: 0 }, outcome: 'permanent' },
    { label: 'a negative timeout', patch: { timeoutMs: -1 }, outcome: 'permanent' },
    { label: 'a non-finite timeout', patch: { timeoutMs: Number.NaN }, outcome: 'permanent' },
  ];

  for (const { label, patch, outcome } of cases) {
    it(`refuses ${label} without issuing a request`, async () => {
      const { fetch, calls } = accepted();

      const result = await sendNotificationEmail({ ...INPUT, ...patch }, fetch);

      assert.equal(calls.length, 0, 'no request was made');
      assert.equal((result as { outcome: string }).outcome, outcome);
      assert.equal((result as { acceptance: string }).acceptance, 'rejected', 'nothing was sent');
    });
  }

  it('does not echo the supplied key when refusing it', async () => {
    const { fetch } = accepted();

    const result = await sendNotificationEmail({ ...INPUT, apiKey: '  ' }, fetch);

    assert.equal((result as { reason: string }).reason.includes('  '), false, 'the supplied key is not echoed');
  });
});

describe('purity', () => {
  it('reads no environment, clock or randomness', async () => {
    // A request that varied between attempts would be refused under the shared
    // idempotency key as a conflicting replay.
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.resend.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    for (const forbidden of [
      'process.env',
      'new Date',
      'Date.now',
      'Math.random',
      'randomUUID',
      'dbPool',
      'require(',
      'setTimeout',
    ]) {
      assert.equal(code.includes(forbidden), false, `the adapter must not use ${forbidden}`);
    }
  });

  it('contains no retry loop', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.resend.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

    // Exactly one call site, and nothing that could run it twice.
    assert.equal(code.match(/fetchImpl\(/g)?.length, 1, 'one fetch call site');
    assert.doesNotMatch(code, /\bfor\s*\(|\bwhile\s*\(|\.retry\b/);
  });

  it('defaults to the global fetch in production', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/modules/notifications/notifications.resend.ts', 'utf8');

    assert.match(code, /globalThis\.fetch/, 'the seam has a real default');
    assert.match(code, /fetchImpl: FetchLike = defaultFetch/);
  });

  it('pins the idempotency key with no hash, attempt or timestamp', async () => {
    const { fetch, calls } = accepted();

    await sendNotificationEmail(
      { ...INPUT, eventType: 'package_reservation_created', bookingReference: 'TPP-J8K9L2M3N4P5' },
      fetch,
    );

    assert.equal(
      headersOf(calls[0] as Call)['Idempotency-Key'],
      'package_reservation_created:TPP-J8K9L2M3N4P5',
    );
  });
});
