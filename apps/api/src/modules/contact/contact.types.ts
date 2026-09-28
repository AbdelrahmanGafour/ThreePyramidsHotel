/**
 * What a contact inquiry is, once it has been checked.
 *
 * The public form is the only thing that posts here, and everything it sends
 * is untrusted: a name, an address, and a free-text message from an anonymous
 * visitor on the open internet. So this module names exactly the six fields a
 * stored inquiry may contain, and nothing else survives validation.
 *
 * In particular the honeypot does not. It is a request-shaped field, not a
 * business fact, and carrying it past the validator would mean every later
 * layer had to remember not to store it.
 */

/**
 * What a visitor may say the inquiry is about.
 *
 * The same four labels, in the same words, that the public form offers and the
 * `contact_inquiries_inquiry_type_check` constraint allows. Three copies of one
 * list is two too many, but the other two are a React component and a SQL
 * CHECK, so this is the one the API is held to.
 */
export const CONTACT_INQUIRY_TYPES = [
  'Room reservation',
  'Curated journey',
  'Airport transfer',
  'General inquiry',
] as const;

export type ContactInquiryType = (typeof CONTACT_INQUIRY_TYPES)[number];

/**
 * A validated inquiry, carrying only business fields.
 *
 * Every string here is already trimmed. `phone` is the one optional field, and
 * absent is `null` rather than `undefined` or `''` — one way to say "no phone",
 * matching the column that stores it.
 */
export type ContactInquiryInput = {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly inquiryType: ContactInquiryType;
  readonly message: string;
};

/**
 * The request could not be accepted.
 *
 * One code for every rejection, deliberately. A visitor who fails validation
 * gets the same answer whether they left the message blank or tripped the
 * honeypot, because telling a spammer *which* rule caught them is telling them
 * how to pass next time. The `message` is safe to show; nothing here ever
 * echoes a submitted value.
 */
export class ContactInquiryValidationError extends Error {
  readonly code = 'INVALID_CONTACT_INQUIRY';
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ContactInquiryValidationError';
  }
}

export function isContactInquiryValidationError(
  error: unknown,
): error is ContactInquiryValidationError {
  return error instanceof ContactInquiryValidationError;
}

export function invalidInquiry(message: string): never {
  throw new ContactInquiryValidationError(message);
}
