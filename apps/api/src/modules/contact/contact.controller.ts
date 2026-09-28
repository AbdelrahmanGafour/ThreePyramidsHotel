import type { Request, Response } from 'express';
import { submitContactInquiry } from './contact.service';
import { isContactInquiryValidationError } from './contact.types';

/**
 * The only thing a refused submission is ever told.
 *
 * Fixed, so no refusal can be distinguished from any other — see the handler
 * below for why that matters more here than the diagnostic value it costs.
 */
const PUBLIC_REFUSAL_MESSAGE = 'Your inquiry could not be accepted';

/**
 * The public contact endpoint's HTTP edge.
 *
 * Three answers and no others: accepted, refused, or something went wrong.
 *
 * `202 Accepted` rather than `201 Created` is the honest status. Nothing is
 * created that the visitor can address — there is no contact resource to
 * fetch, and the email has not been sent yet. The request has been accepted
 * for processing, which is exactly what 202 means.
 */
export async function submitContactInquiryHandler(req: Request, res: Response): Promise<void> {
  try {
    res.status(202).json({ data: await submitContactInquiry(req.body) });
  } catch (error) {
    // One BODY for every refusal, not merely one code.
    //
    // The validator's own message is deliberately discarded here. It is
    // specific by design — "firstName is required", "email must be a valid
    // email address" — and that specificity is exactly what would let a bot
    // tell the honeypot apart from an ordinary mistake: a filled trap would
    // answer differently from a blank field, and two probes would find it.
    //
    // So every rejection is byte-identical at the edge. The specific reasons
    // remain on the error for logs and tests; they just do not leave the
    // process. A legitimate visitor is unaffected: the form applies the same
    // rules in the browser, so a real person is told which field to fix there.
    if (isContactInquiryValidationError(error)) {
      res.status(error.status).json({
        error: { code: error.code, message: PUBLIC_REFUSAL_MESSAGE },
      });
      return;
    }

    // A fixed body. No driver message, no constraint name, no SQLSTATE, no
    // internal id, and nothing the visitor submitted — an error page is a poor
    // place to discover that an email address was echoed back.
    res.status(500).json({
      error: {
        code: 'CONTACT_INQUIRY_FAILED',
        message: 'Your inquiry could not be submitted',
      },
    });
  }
}
