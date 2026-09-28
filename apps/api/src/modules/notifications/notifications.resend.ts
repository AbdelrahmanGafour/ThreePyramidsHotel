import type { NotificationAcceptance } from './notifications.repository';

// One HTTP request to Resend, and no opinions about what to do next.
//
// This adapter sends exactly one email and reports what happened. It does not
// retry, does not sleep, does not write to the database, does not read the
// environment and does not decide anything about scheduling. A caller hands it
// a rendered message and a frozen envelope; it hands back a classification.
//
// ---------------------------------------------------------------------------
// TWO AXES, DELIBERATELY SEPARATE
//
// Every failure answers two different questions, and collapsing them is the
// mistake this type exists to prevent:
//
//   outcome     what a dispatcher should DO — retry soon, stop for a human, or
//               give up on this row. Ephemeral, never stored.
//   acceptance  what is TRUE about the provider — `rejected` means no message
//               exists and none ever will from this attempt; `unknown` means
//               one may already be on its way. Durable, and the field a person
//               reads months later when deciding whether resending a
//               confirmation would double-send it to a guest.
//
// They are genuinely independent. A validation refusal is permanent AND
// definitely un-accepted. A timeout is retryable AND ambiguous. A rate limit
// is retryable AND definitely un-accepted. No single enum says both.
//
// ---------------------------------------------------------------------------
// FAIL CLOSED ON ACCEPTANCE
//
// `rejected` is a claim that nothing was sent, and something later relies on
// it. So it is returned ONLY for the cases named explicitly below, and it is
// never inferred from an HTTP status class alone.
//
// Only three statuses are definitive on their own — 401, 404 and 405 — because
// each says the request never reached message handling at all. Every other 4xx
// needs its provider code recognised before anything may be concluded: a 422
// this file understands is a validation refusal, but a 422 it does not
// understand is simply a 422, and Resend could add one tomorrow that means
// something was queued. Guessing from the status would be exactly the
// fail-open this rule exists to prevent.
//
// Everything unrecognised is `transient` + `unknown`. Being wrong in that
// direction costs a duplicate email; being wrong in the other costs a guest
// never hearing that their booking was confirmed.

/** Where every message goes. Fixed, because this file is the Resend adapter. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** What a dispatcher should do about a failure. Ephemeral, never persisted. */
export type ProviderFailureOutcome = 'transient' | 'permanent' | 'blocked';

export type ProviderFailure = {
  readonly outcome: ProviderFailureOutcome;
  readonly acceptance: NotificationAcceptance;
  /** Safe for a log and for `last_error`. Never a secret, never guest content. */
  readonly reason: string;
  readonly status?: number;
  readonly providerCode?: string;
};

/**
 * `accepted` means Resend answered 2xx with an id.
 *
 * It means the provider took the message, and nothing more. It is not
 * delivery, not an inbox, not a read receipt. Naming it `accepted` rather than
 * `sent` is the point: if delivery is ever tracked it will need its own
 * signal, and nothing here should be mistaken for one.
 */
export type ProviderResult =
  | { readonly outcome: 'accepted'; readonly providerReference: string }
  | ProviderFailure;

export type SendNotificationEmailInput = {
  readonly apiKey: string;
  /** Both halves of the idempotency key, exactly as the outbox row holds them. */
  readonly eventType: string;
  readonly bookingReference: string;
  /** The envelope, frozen at the first claim. Used exactly as given. */
  readonly resolvedFrom: string;
  readonly resolvedTo: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly timeoutMs: number;
};

/** Just enough of `fetch` to send one request, so a test needs no global. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/**
 * The idempotency key, pinned.
 *
 * `${eventType}:${bookingReference}` and nothing else. No hash, no attempt
 * number, no timestamp — every one of those would make a retry a different
 * request, which is exactly what the key exists to prevent. Resend keeps a key
 * for 24 hours and replays the original response for a repeat of the same
 * payload, so this is what stops a redelivered attempt becoming a second email.
 *
 * It is also why the request body must be byte-identical across retries: the
 * same key with a *different* payload is refused as a conflicting replay.
 */
function idempotencyKeyFor(eventType: string, bookingReference: string): string {
  return `${eventType}:${bookingReference}`;
}

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** An email address anywhere in provider text. Redacted before it is returned. */
const EMAIL_PATTERN = /[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>",;)]+/g;

/** Provider messages are for a person, not a parser, and are capped. */
const MAX_REASON_LENGTH = 200;

/**
 * Makes provider text safe to return, log and store in `last_error`.
 *
 * Three things must never come back out of this adapter: the API key, a guest's
 * address, and anything long enough to be a body. Resend's own messages do
 * quote addresses — `invalid_to_address` is the obvious one — so redaction is
 * not defensive padding, it is the normal path.
 */
function redact(text: string, apiKey: string): string {
  let safe = text.replace(EMAIL_PATTERN, '[redacted-email]');

  // A key should never appear in a provider message. If one ever did, it would
  // be the single worst thing to write to a log.
  if (apiKey.length > 0) {
    safe = safe.split(apiKey).join('[redacted-key]');
  }

  safe = safe.replace(/\s+/g, ' ').trim();

  return safe.length > MAX_REASON_LENGTH ? `${safe.slice(0, MAX_REASON_LENGTH)}…` : safe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pulls a code and a message out of whatever Resend sent back.
 *
 * Deliberately total. A gateway in front of the provider can answer HTML, an
 * empty body, or nothing at all, and none of that may throw — the status is
 * the part that matters and it is already in hand.
 */
function readProviderError(body: unknown): { code?: string; message?: string } {
  if (!isRecord(body)) {
    return {};
  }

  // Resend answers `{ statusCode, message, name }`; some gateways nest it.
  const error = isRecord(body.error) ? body.error : body;
  const code = error.name ?? error.code ?? error.type;
  const message = error.message ?? error.detail;

  return {
    ...(typeof code === 'string' && code.length > 0 ? { code } : {}),
    ...(typeof message === 'string' && message.length > 0 ? { message } : {}),
  };
}

/** True when a 403/422 is really "this sending domain is not verified". */
function looksLikeUnverifiedDomain(code: string, message: string): boolean {
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes('domain is not verified') ||
    haystack.includes('domain not verified') ||
    haystack.includes('unverified domain') ||
    haystack.includes('verify a domain') ||
    haystack.includes('not verified')
  );
}

/**
 * True when a 429 is an exhausted allowance rather than a momentary limit.
 *
 * Checked before the rate-limit recogniser, because "daily limit reached" is
 * both, and only one of the two clears on a retry timescale.
 */
function looksLikeQuota(code: string, message: string): boolean {
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes('quota') ||
    haystack.includes('daily limit') ||
    haystack.includes('monthly limit')
  );
}

/** True when a 429 is a momentary rate limit. */
function looksLikeRateLimit(code: string, message: string): boolean {
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes('rate_limit') ||
    haystack.includes('rate limit') ||
    haystack.includes('too_many_requests') ||
    haystack.includes('too many requests')
  );
}

/** True when a 403 is this account being restricted or suspended. */
function looksLikeAccountRestriction(code: string, message: string): boolean {
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes('restricted') ||
    haystack.includes('suspended') ||
    haystack.includes('security_error') ||
    haystack.includes('invalid_access')
  );
}

/** True when a 422 is a validation or address refusal. */
function looksLikeValidation(code: string, message: string): boolean {
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes('validation') ||
    haystack.includes('missing_required_field') ||
    haystack.includes('invalid_from_address') ||
    haystack.includes('invalid_to_address') ||
    haystack.includes('invalid_attachment') ||
    haystack.includes('invalid_parameter')
  );
}

/**
 * The whole mapping, in one place.
 *
 * Each arm states both axes explicitly rather than deriving one from the
 * other, because the interesting cases are exactly the ones where they
 * disagree: a 429 rate limit is retryable but definitely un-accepted, and a
 * 409 conflicting replay is permanent but ambiguous.
 */
function classify(status: number, code: string, message: string): {
  outcome: ProviderFailureOutcome;
  acceptance: NotificationAcceptance;
} {
  // 5xx: the request reached the provider and may or may not have been taken.
  if (status >= 500) {
    return { outcome: 'transient', acceptance: 'unknown' };
  }

  switch (status) {
    case 401:
      // No key, or a key the provider will not honour. Definitive on the
      // status alone: authentication happens before anything is queued.
      return { outcome: 'blocked', acceptance: 'rejected' };

    case 404:
    case 405:
      // The endpoint or method is wrong, so no handler ran. This build is
      // broken rather than the row, but waiting fixes neither.
      return { outcome: 'permanent', acceptance: 'rejected' };

    case 403:
      // Only two 403s are recognised, and both need a human.
      if (looksLikeUnverifiedDomain(code, message)) {
        return { outcome: 'blocked', acceptance: 'rejected' };
      }
      if (looksLikeAccountRestriction(code, message)) {
        return { outcome: 'blocked', acceptance: 'rejected' };
      }

      // Some other 403. It may mean nothing was sent, but this file cannot
      // prove that, so it does not say it.
      return { outcome: 'transient', acceptance: 'unknown' };

    case 409:
      // The idempotency key was reused. Which way depends on how.
      if (code === 'concurrent_idempotent_requests') {
        // Another request with this key is in flight right now — very likely
        // this row's own previous attempt. It may yet be accepted.
        return { outcome: 'transient', acceptance: 'unknown' };
      }

      // `invalid_idempotent_request`: this key was used with a DIFFERENT
      // payload. Retrying is refused identically until the payload changes,
      // so it is permanent — but the original request under this key may well
      // have been accepted, so acceptance is emphatically unknown.
      return { outcome: 'permanent', acceptance: 'unknown' };

    case 422:
      // Domain verification first: Resend reports it as a `validation_error`,
      // so the more specific test has to run before the general one.
      if (looksLikeUnverifiedDomain(code, message)) {
        return { outcome: 'blocked', acceptance: 'rejected' };
      }
      if (looksLikeValidation(code, message)) {
        // This message cannot be sent as it stands, and it was not.
        return { outcome: 'permanent', acceptance: 'rejected' };
      }

      return { outcome: 'transient', acceptance: 'unknown' };

    case 429:
      if (looksLikeQuota(code, message)) {
        // An exhausted daily or monthly allowance does not clear on the sort
        // of timescale a retry uses.
        return { outcome: 'blocked', acceptance: 'rejected' };
      }
      if (looksLikeRateLimit(code, message)) {
        // Refused outright, but worth trying again shortly.
        return { outcome: 'transient', acceptance: 'rejected' };
      }

      return { outcome: 'transient', acceptance: 'unknown' };

    case 400:
      if (code === 'invalid_idempotency_key') {
        // The key itself was malformed, so nothing was processed, and it will
        // be malformed in exactly the same way next time.
        return { outcome: 'permanent', acceptance: 'rejected' };
      }

      // Any other 400. A bad request usually means nothing happened — but
      // "usually" is not the standard this axis is held to.
      return { outcome: 'transient', acceptance: 'unknown' };

    default:
      // Anything this file does not recognise. Assume a message may exist and
      // let a later attempt find out.
      return { outcome: 'transient', acceptance: 'unknown' };
  }
}

/** A local argument fault, reported without ever touching the network. */
function invalidArgument(
  outcome: ProviderFailureOutcome,
  reason: string,
): ProviderFailure {
  return { outcome, acceptance: 'rejected', reason };
}

/**
 * Sends one notification email through Resend.
 *
 * Exactly one HTTP request, every time. No retry loop lives here: a retry is a
 * scheduling decision, it needs the outbox row's attempt count and the
 * dispatcher's policy, and an adapter that quietly retried would spend a row's
 * budget without anybody recording that it had.
 *
 * The envelope is used exactly as supplied. This function never resolves a
 * hotel address, never reads configuration and never touches a clock or a
 * random number, so the request it builds is a pure function of its input —
 * which is what lets a retry send a byte-identical body under the same
 * idempotency key.
 *
 * Nothing is persisted. The caller records the result.
 */
export async function sendNotificationEmail(
  input: SendNotificationEmailInput,
  fetchImpl: FetchLike = defaultFetch,
): Promise<ProviderResult> {
  // Checked before anything is sent, so a misconfigured deployment cannot make
  // a request that was always going to be refused.
  if (!isNonEmpty(input.apiKey)) {
    // Deployment-wide rather than row-specific: every send will fail the same
    // way until somebody supplies a key.
    return invalidArgument('blocked', 'No Resend API key was supplied');
  }
  if (!isNonEmpty(input.resolvedFrom)) {
    return invalidArgument('permanent', 'The sender address is empty');
  }
  if (!isNonEmpty(input.resolvedTo)) {
    return invalidArgument('permanent', 'The recipient address is empty');
  }
  if (!isNonEmpty(input.eventType) || !isNonEmpty(input.bookingReference)) {
    return invalidArgument('permanent', 'The idempotency key is incomplete');
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    return invalidArgument('permanent', 'The request timeout must be a positive number of milliseconds');
  }

  // Built field by field, in a fixed order, from nothing but the input. Never
  // spread: the caller's object may hold more than a provider should see.
  const body = JSON.stringify({
    from: input.resolvedFrom,
    to: input.resolvedTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  let response: Response;

  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKeyFor(input.eventType, input.bookingReference),
      },
      body,
      // Native, so no dependency and no timer to clear by hand.
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    // A request that never got an answer. It may have reached the provider and
    // been accepted before the connection died, so nothing may be concluded —
    // this is the ambiguity the whole `unknown` axis exists for.
    const timedOut =
      isRecord(error) && (error.name === 'TimeoutError' || error.name === 'AbortError');

    return {
      outcome: 'transient',
      acceptance: 'unknown',
      reason: timedOut
        ? `The request to the email provider timed out after ${input.timeoutMs}ms`
        : 'The email provider could not be reached',
    };
  }

  // Read once, defensively: a gateway can answer HTML or nothing at all, and a
  // parse failure must not become a thrown error that hides the status.
  const payload = await response.json().then(
    (value: unknown) => value,
    () => undefined,
  );

  if (response.ok) {
    const providerReference = isRecord(payload) && typeof payload.id === 'string' ? payload.id.trim() : '';

    if (providerReference.length > 0) {
      return { outcome: 'accepted', providerReference };
    }

    // A 2xx this adapter cannot read. The provider almost certainly took the
    // message — it answered success — so claiming rejection would be a lie,
    // and claiming acceptance would store a reference that does not exist.
    return {
      outcome: 'transient',
      acceptance: 'unknown',
      status: response.status,
      reason: 'The email provider returned success without a usable message id',
    };
  }

  const { code, message } = readProviderError(payload);
  const { outcome, acceptance } = classify(response.status, code ?? '', message ?? '');
  const detail = message ? redact(message, input.apiKey) : 'no provider message';

  return {
    outcome,
    acceptance,
    status: response.status,
    ...(code ? { providerCode: code } : {}),
    reason: `The email provider returned ${response.status}: ${detail}`,
  };
}
