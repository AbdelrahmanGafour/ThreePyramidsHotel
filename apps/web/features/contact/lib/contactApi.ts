import { requestJson, type ClientResponse } from "@/lib/api/client";
import type { ContactInquiryDetails } from "@/features/contact/types";

// Browser-side contact submission. Calls the same-origin Next bridge
// (/api/v1/contact) through lib/api/client.ts — never Express directly, never
// API_BASE_URL, which this file could not read even if it wanted to.
//
// The backend is authoritative. Client-side validation runs first so a visitor
// is told about a missing field without a round trip, but it is a convenience:
// Express validates the same request again and its answer is the one that
// decides whether an inquiry was accepted.

/** What the form sends, including the honeypot it never shows anyone. */
export type ContactInquiryRequest = ContactInquiryDetails & {
  /**
   * The honeypot, forwarded exactly as the form holds it.
   *
   * Always sent, always empty for a real visitor. Omitting it when blank would
   * be a small tell that something is watching it.
   */
  website: string;
};

/**
 * Three outcomes, as an explicit union.
 *
 * `refused` and `failed` are separate because they mean different things to a
 * person: one says the inquiry was understood and rejected, the other says
 * something broke. Both leave the visitor on the form with their words intact,
 * so the UI happens to treat them alike today — but a caller that conflated
 * them in the type could never tell them apart later.
 */
export type SubmitContactInquiryResult =
  | { outcome: "success" }
  | { outcome: "refused" }
  | { outcome: "failed" };

/**
 * The one sentence a visitor is shown when a submission does not go through.
 *
 * Deliberately generic and identical for every failure. The backend already
 * refuses to say which rule caught a submission — so that a bot cannot find
 * the honeypot by probing — and repeating a more specific story here would
 * undo that. It also never shows a status code, an error code or anything the
 * server said.
 */
export const CONTACT_SUBMISSION_ERROR_MESSAGE =
  "Your inquiry could not be sent just now. Please check your details and try again, or call us directly.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decides what a bridge response means.
 *
 * Pure and exported so it can be tested directly, the same arrangement
 * `features/booking/lib/reservations.ts` uses.
 *
 * A 202 is only a success if it actually carries `{ data: { received: true } }`.
 * A success this function cannot read is NOT treated as one: the inquiry may
 * well have been queued, but the page must not claim an outcome it cannot
 * verify, and telling somebody their message was received when it may not have
 * been is the one mistake worth guarding against here.
 */
export function classifyContactResponse(response: ClientResponse<unknown>): SubmitContactInquiryResult {
  if (response.status === 202) {
    const body = response.body;

    if (isRecord(body) && isRecord(body.data) && body.data.received === true) {
      return { outcome: "success" };
    }

    return { outcome: "failed" };
  }

  // The backend's own refusal. Its message is deliberately not read: it is
  // generic by design, and the visitor is shown this app's wording either way.
  if (response.status === 400) {
    return { outcome: "refused" };
  }

  return { outcome: "failed" };
}

/**
 * Submits one contact inquiry.
 *
 * Exactly one request, never retried. A POST that was not answered may already
 * have queued the inquiry, and sending it again would mean a second email to
 * the hotel about the same message.
 *
 * A transport failure — offline, DNS, a dropped connection — resolves as
 * `failed` rather than throwing, so the form has one thing to handle.
 */
export async function submitContactInquiry(
  input: ContactInquiryRequest,
): Promise<SubmitContactInquiryResult> {
  let response: ClientResponse<unknown>;

  try {
    response = await requestJson("/api/v1/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        inquiryType: input.inquiryType,
        message: input.message,
        website: input.website,
      }),
    });
  } catch {
    return { outcome: "failed" };
  }

  return classifyContactResponse(response);
}
