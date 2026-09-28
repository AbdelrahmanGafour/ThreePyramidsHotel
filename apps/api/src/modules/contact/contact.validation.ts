import {
  CONTACT_INQUIRY_TYPES,
  invalidInquiry,
  type ContactInquiryInput,
  type ContactInquiryType,
} from './contact.types';

/**
 * Turns an untrusted request body into a `ContactInquiryInput`, or throws.
 *
 * Pure: it takes an unknown value, reads it without mutating it, and either
 * returns the six business fields or raises
 * `ContactInquiryValidationError`. No database, no clock, no environment.
 *
 * Written in the same shape as `parsePackageReservationInput`: a whitelist of
 * accepted keys, a plain-object check that rejects arrays and exotic
 * prototypes, and small helpers that trim before measuring. The limits match
 * the `contact_inquiries` CHECK constraints exactly, so a value this function
 * accepts cannot be refused by the column that stores it.
 *
 * Every rejection carries one code. See `ContactInquiryValidationError` for
 * why the reasons are not differentiated for the caller.
 */

/**
 * Everything the form is allowed to send, including the honeypot.
 *
 * A whitelist rather than a blacklist of known server-owned fields: an
 * unrecognised key is refused outright, so a field added to the table later
 * cannot be set from outside by a request that happened to guess its name.
 */
const ALLOWED = new Set([
  'firstName',
  'lastName',
  'email',
  'phone',
  'inquiryType',
  'message',
  'website',
]);

const MAX_LENGTHS = {
  name: 100,
  email: 254,
  phone: 50,
  message: 2000,
} as const;

/**
 * The same practical rules the public form applies.
 *
 * Deliberately identical to `apps/web/features/contact/lib/validation.ts`, so
 * a visitor is never told their address is fine by the page and wrong by the
 * server. Both are modest on purpose: neither pretends to implement RFC 5322.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;
const MIN_PHONE_DIGITS = 7;

/**
 * Required text, trimmed and measured.
 *
 * The trimmed value is what is returned and ultimately stored: leading and
 * trailing whitespace is never meaningful in a name, an address or a message,
 * and the column's own CHECK rejects a value that is only whitespace. Length
 * is measured AFTER trimming, so a name padded to 120 characters is judged on
 * the name.
 */
function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    invalidInquiry(`${field} must be text`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    invalidInquiry(`${field} is required`);
  }
  if (trimmed.length > max) {
    invalidInquiry(`${field} must be ${max} characters or fewer`);
  }

  return trimmed;
}

/** One of the four labels, matched exactly — no casing or spacing latitude. */
function inquiryType(value: unknown): ContactInquiryType {
  const match = CONTACT_INQUIRY_TYPES.find((candidate) => candidate === value);

  if (!match) {
    invalidInquiry('inquiryType must be one of the offered options');
  }

  return match;
}

/**
 * The one optional field.
 *
 * Absent, `null`, or a string that is only whitespace all mean the same thing
 * and all become `null` — one representation of "no phone", matching the
 * nullable column. A present number is still refused: a phone number is not
 * arithmetic, and `+20` cannot survive being one.
 */
function optionalPhone(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    invalidInquiry('phone must be text');
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > MAX_LENGTHS.phone) {
    invalidInquiry(`phone must be ${MAX_LENGTHS.phone} characters or fewer`);
  }
  if (!PHONE_PATTERN.test(trimmed) || trimmed.replace(/\D/g, '').length < MIN_PHONE_DIGITS) {
    invalidInquiry('phone must be a valid phone number');
  }

  return trimmed;
}

/**
 * The honeypot.
 *
 * `website` is rendered hidden and no person ever fills it in; a bot that fills
 * every field it finds does. A non-blank value therefore means "not a person",
 * and the request is refused.
 *
 * The refusal is deliberately indistinguishable from any other validation
 * failure — same error type, same code, and a message that says nothing about
 * honeypots or spam. Telling a bot which rule caught it is telling it how to
 * pass next time. It is also why this returns nothing: `website` is a trap,
 * not a fact about the inquiry, and it stops here.
 */
function checkHoneypot(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  // A non-string is as unlike an untouched hidden input as a filled one.
  if (typeof value !== 'string' || value.trim().length > 0) {
    invalidInquiry('This inquiry could not be accepted');
  }
}

/**
 * Parses and validates one contact inquiry request body.
 *
 * @throws {ContactInquiryValidationError} for anything it will not accept.
 */
export function parseContactInquiryInput(body: unknown): ContactInquiryInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalidInquiry('Contact inquiry body must be a JSON object');
  }

  // Only a plain object, or a null-prototype one as `JSON.parse` with a
  // reviver can produce. A Date, Map or class instance is an object whose
  // fields would not survive a JSON round trip.
  const prototype = Object.getPrototypeOf(body);

  if (prototype !== Object.prototype && prototype !== null) {
    invalidInquiry('Contact inquiry body must be a JSON object');
  }

  // `Reflect.ownKeys` rather than `Object.keys`, so a symbol-keyed property
  // cannot smuggle itself past the whitelist.
  for (const key of Reflect.ownKeys(body)) {
    if (typeof key !== 'string' || !ALLOWED.has(key)) {
      invalidInquiry('Contact inquiry body contains an unexpected field');
    }
  }

  const row = body as Record<string, unknown>;

  // Checked first, and its result discarded. A submission that trips the trap
  // is refused before its other fields are even read.
  checkHoneypot(row.website);

  const email = requiredText(row.email, 'email', MAX_LENGTHS.email);

  if (!EMAIL_PATTERN.test(email)) {
    invalidInquiry('email must be a valid email address');
  }

  return {
    firstName: requiredText(row.firstName, 'firstName', MAX_LENGTHS.name),
    lastName: requiredText(row.lastName, 'lastName', MAX_LENGTHS.name),
    email,
    phone: optionalPhone(row.phone),
    inquiryType: inquiryType(row.inquiryType),
    message: requiredText(row.message, 'message', MAX_LENGTHS.message),
  };
}
