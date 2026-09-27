import "server-only";

import { ApiConfigurationError, resolveApiBaseUrl } from "@/shared/server/apiBaseUrl";
import type { AdminSessionAdministrator } from "./adminAuthApi";

// Server-only client for the two admin account-settings endpoints.
//
// The import above is the boundary: importing this module from client code
// fails the build, so the API address never reaches the browser bundle and no
// password can be sent from a browser to anything but this app's own Server
// Actions.
//
// Express plus PostgreSQL remain the authority. This module decides nothing
// about credentials: it forwards the caller's Cookie header verbatim, sends the
// exact body each endpoint is contracted for, and reports which answer came
// back. Nothing here is logged — a request body on these two endpoints is a
// password, and a client that starts logging bodies is one that eventually
// logs one.
//
// Exactly one request per call, never retried. A PATCH that was not answered
// may already have committed, so a second attempt could change a password
// twice or report a failure for a change that happened.

const ADMIN_ACCOUNT_BASE_PATH = "/api/v1/admin/auth/account";

/** The exact error bodies the API is contracted to send. */
const NOT_AUTHENTICATED_ERROR = {
  code: "NOT_AUTHENTICATED",
  message: "Authentication required",
} as const;

const INVALID_CREDENTIALS_ERROR = {
  code: "INVALID_CREDENTIALS",
  message: "Invalid email or password",
} as const;

const INVALID_ACCOUNT_UPDATE_ERROR = {
  code: "INVALID_ADMIN_ACCOUNT_UPDATE",
  message: "Invalid account update request",
} as const;

const EMAIL_IN_USE_ERROR = {
  code: "ADMIN_EMAIL_IN_USE",
  message: "That email address is already in use",
} as const;

const PASSWORD_UNCHANGED_ERROR = {
  code: "ADMIN_PASSWORD_UNCHANGED",
  message: "The new password must be different from the current password",
} as const;

// The two ways this client can fail before the API answers. Distinct on
// purpose: a wrong or missing API address is a deployment fault, not an
// outage, and neither ever echoes the configured value.
const UNREACHABLE_REASON = "The hotel API could not be reached.";
const MISCONFIGURED_REASON = "The hotel system is not configured correctly.";
const UNREADABLE_RESPONSE_REASON = "The hotel API returned an unreadable response.";
const UNEXPECTED_RESPONSE_REASON = "The hotel API returned an unexpected response.";

/**
 * Six outcomes for an email change. A malformed request, an unverifiable
 * current password and an address another account holds are three different
 * answers, and a page that treated them alike would tell an administrator to
 * fix the wrong thing.
 */
export type AdminEmailChangeResult =
  | { state: "ok"; administrator: AdminSessionAdministrator }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "credentials" }
  | { state: "email-in-use" }
  | { state: "unavailable"; reason: string };

/** The same five refusals for a password change, with its own conflict. */
export type AdminPasswordChangeResult =
  | { state: "ok" }
  | { state: "unauthenticated" }
  | { state: "invalid" }
  | { state: "credentials" }
  | { state: "password-unchanged" }
  | { state: "unavailable"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only for the exact error body the API is contracted to send. */
function matchesApiError(payload: unknown, expected: { code: string; message: string }): boolean {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return false;
  }

  return payload.error.code === expected.code && payload.error.message === expected.message;
}

async function readJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Rebuilds the administrator from a 200 body.
 *
 * Nothing is spread: the object returned is built from two checked strings, so
 * a field the API adds later — an internal id included — cannot reach a page
 * just by existing.
 */
function toAdministrator(payload: unknown): AdminSessionAdministrator | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }

  const administrator = payload.data.administrator;

  if (!isRecord(administrator)) {
    return null;
  }

  const { email, displayName } = administrator;

  if (typeof email !== "string" || typeof displayName !== "string") {
    return null;
  }

  return { email, displayName };
}

type AccountRequest = {
  path: "/email" | "/password";
  /** The exact body the endpoint is contracted for, and nothing else. */
  body: Record<string, string>;
  cookie?: string | undefined;
};

/**
 * Sends one PATCH and returns the raw response, or `null` when the request
 * could not be made at all.
 *
 * `null` rather than a thrown error so both callers map "never asked" to their
 * own `unavailable` without repeating a try/catch. The reason travels beside
 * it and never contains the configured address.
 */
async function patchAccount(
  request: AccountRequest,
): Promise<{ response: Response } | { reason: string }> {
  let baseUrl: string;

  try {
    baseUrl = resolveApiBaseUrl();
  } catch (error) {
    return { reason: error instanceof ApiConfigurationError ? MISCONFIGURED_REASON : UNREACHABLE_REASON };
  }

  try {
    const response = await fetch(`${baseUrl}${ADMIN_ACCOUNT_BASE_PATH}${request.path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(request.cookie ? { Cookie: request.cookie } : {}),
      },
      body: JSON.stringify(request.body),
      // An account change is never cacheable.
      cache: "no-store",
    });

    return { response };
  } catch {
    return { reason: UNREACHABLE_REASON };
  }
}

/**
 * Changes the signed-in administrator's own email.
 *
 * The body is exactly `{ currentPassword, email }`. No account is named: whose
 * account this is comes from the forwarded session cookie, and the API takes no
 * target parameter.
 *
 * The address is sent as typed. Normalising it here would be a second opinion
 * able to disagree with the API's, which is the one that decides what gets
 * stored.
 */
export async function changeAdminAccountEmail(
  input: { currentPassword: string; email: string },
  cookie?: string,
): Promise<AdminEmailChangeResult> {
  const attempt = await patchAccount({
    path: "/email",
    body: { currentPassword: input.currentPassword, email: input.email },
    cookie,
  });

  if ("reason" in attempt) {
    return { state: "unavailable", reason: attempt.reason };
  }

  const { response } = attempt;

  if (response.status === 200) {
    const payload = await readJson(response);

    if (payload === undefined) {
      return { state: "unavailable", reason: UNREADABLE_RESPONSE_REASON };
    }

    const administrator = toAdministrator(payload);

    if (!administrator) {
      // A 200 this client cannot read is not a confirmed change.
      return { state: "unavailable", reason: UNEXPECTED_RESPONSE_REASON };
    }

    return { state: "ok", administrator };
  }

  if (response.status === 400 || response.status === 401 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_ACCOUNT_UPDATE_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 401) {
      // Two different facts behind one status. The session having ended sends
      // the administrator to sign in; a wrong current password keeps them on
      // the form.
      if (matchesApiError(payload, NOT_AUTHENTICATED_ERROR)) {
        return { state: "unauthenticated" };
      }
      if (matchesApiError(payload, INVALID_CREDENTIALS_ERROR)) {
        return { state: "credentials" };
      }
    }

    if (response.status === 409 && matchesApiError(payload, EMAIL_IN_USE_ERROR)) {
      return { state: "email-in-use" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}

/**
 * Changes the signed-in administrator's own password.
 *
 * The body is exactly `{ currentPassword, newPassword }`. The confirmation
 * field the form collects is this website's own check and is never sent.
 *
 * A 204 means every session for the account is already gone, this one
 * included. There is no body to read and none is read.
 */
export async function changeAdminAccountPassword(
  input: { currentPassword: string; newPassword: string },
  cookie?: string,
): Promise<AdminPasswordChangeResult> {
  const attempt = await patchAccount({
    path: "/password",
    body: { currentPassword: input.currentPassword, newPassword: input.newPassword },
    cookie,
  });

  if ("reason" in attempt) {
    return { state: "unavailable", reason: attempt.reason };
  }

  const { response } = attempt;

  if (response.status === 204) {
    return { state: "ok" };
  }

  if (response.status === 400 || response.status === 401 || response.status === 409) {
    const payload = await readJson(response);

    if (response.status === 400 && matchesApiError(payload, INVALID_ACCOUNT_UPDATE_ERROR)) {
      return { state: "invalid" };
    }

    if (response.status === 401) {
      if (matchesApiError(payload, NOT_AUTHENTICATED_ERROR)) {
        return { state: "unauthenticated" };
      }
      if (matchesApiError(payload, INVALID_CREDENTIALS_ERROR)) {
        return { state: "credentials" };
      }
    }

    if (response.status === 409 && matchesApiError(payload, PASSWORD_UNCHANGED_ERROR)) {
      return { state: "password-unchanged" };
    }

    return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
  }

  // Includes a 200 on an endpoint contracted to answer 204: an answer this
  // client does not recognise is not a confirmed change.
  return { state: "unavailable", reason: `The hotel API returned ${response.status}.` };
}
