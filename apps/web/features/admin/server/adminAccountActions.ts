"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_ACCOUNT_PATH,
  ADMIN_LOGIN_PATH,
  adminAccountNoticeHref,
  adminLoginNoticeHref,
  planAdminEmailChange,
  planAdminPasswordChange,
  readAdminEmailForm,
  readAdminPasswordForm,
  type AdminAccountOutcome,
} from "../lib/adminAccount";
import { changeAdminAccountEmail, changeAdminAccountPassword } from "./adminAccountApi";
import { clearAdminSessionCookie } from "./adminSessionCookie";

// The two ways an administrator changes their own account.
//
// Both run on the server and call Express through the server-only client, so
// the browser never sends a password to the API and never learns the API's
// address. The forms post to Next, not to the API.
//
// Neither action decides anything the API decides: what a valid address is,
// whether a password is right, whether an address is taken and whether a new
// password differs from the old one are all the API's answers. The one check
// that is genuinely this website's own is the new-password confirmation, which
// has no API field and must never acquire one.
//
// Nothing here logs. A form body on these two actions is a password, and an
// action that starts logging bodies is one that eventually logs one. No
// submitted value reaches a URL either: every redirect carries a fixed token
// from a closed set, never an address and never a password.

/**
 * Carries out a plan. Always ends by throwing, because every path redirects.
 *
 * `redirect()` works by throwing, so this is deliberately called outside any
 * try/catch.
 */
async function completeOutcome(outcome: AdminAccountOutcome): Promise<never> {
  if (outcome.kind === "login") {
    // The session ended between the page rendering and the form being
    // submitted. Nothing was changed, and nothing is retried after signing in
    // again.
    redirect(ADMIN_LOGIN_PATH);
  }

  if (outcome.kind === "signOut") {
    // The API has already deleted every session for this account, this one
    // included, so there is nothing left to end upstream — the browser is just
    // holding a cookie for a session that no longer exists. Clearing it here
    // is the only thing that actually removes it: a Server Action cannot relay
    // an upstream `Set-Cookie`, so asking the API to log out again would end a
    // session that is already gone and leave the browser's copy untouched.
    //
    // The name and path come from `adminSessionCookie`, the one auth-focused
    // module that states them; this feature does not know what the cookie is
    // called.
    await clearAdminSessionCookie();

    // Both paths are re-read: the shell shows the administrator's address, and
    // no cached copy of an authenticated page may survive a sign-out.
    revalidatePath(ADMIN_ACCOUNT_PATH);
    revalidatePath(ADMIN_LOGIN_PATH);

    redirect(adminLoginNoticeHref(outcome.token));
  }

  if (outcome.revalidateAccount) {
    revalidatePath(ADMIN_ACCOUNT_PATH);
  }

  redirect(adminAccountNoticeHref(outcome.token));
}

/** The browser's own Cookie header, forwarded verbatim and never parsed. */
async function forwardedCookie(): Promise<string | undefined> {
  return (await headers()).get("cookie") ?? undefined;
}

/**
 * Changes the signed-in administrator's own email.
 *
 * Takes no account identity: whose account this is comes from the forwarded
 * session cookie, and neither this action nor the API accepts a target.
 *
 * Sessions are untouched on success — the credential that authenticates did
 * not change — so the administrator stays signed in and lands back on the
 * account page with the new address read fresh from the API.
 */
export async function changeAdminEmailAction(formData: FormData): Promise<void> {
  const input = readAdminEmailForm(formData);

  const cookie = await forwardedCookie();
  const result = await changeAdminAccountEmail(input, cookie);

  await completeOutcome(planAdminEmailChange(result.state));
}

/**
 * Changes the signed-in administrator's own password.
 *
 * The confirmation field is checked here and discarded. It is refused before
 * any request, so a mismatched pair costs no round trip and — more to the
 * point — cannot reach the API, whose contract has two fields and must not
 * grow a third.
 *
 * On success the API has already revoked every session for the account, so the
 * plan clears the browser's now-orphaned cookie through the shared auth helper
 * and sends the administrator to sign in again with the new password.
 */
export async function changeAdminPasswordAction(formData: FormData): Promise<void> {
  const input = readAdminPasswordForm(formData);
  const cookie = await forwardedCookie();

  if (!input.confirmed) {
    // Nothing was asked of the API, so this is deliberately not reported as an
    // API failure. The notice is a fixed token; neither password is echoed
    // anywhere, including in the URL this redirects to.
    await completeOutcome({
      kind: "notice",
      surface: "account",
      token: "password-mismatch",
      revalidateAccount: false,
    });
  }

  const result = await changeAdminAccountPassword(
    // Exactly the two fields the API is contracted for. `confirmed` is a
    // boolean this website computed and is not part of the request.
    { currentPassword: input.currentPassword, newPassword: input.newPassword },
    cookie,
  );

  await completeOutcome(planAdminPasswordChange(result.state));
}
