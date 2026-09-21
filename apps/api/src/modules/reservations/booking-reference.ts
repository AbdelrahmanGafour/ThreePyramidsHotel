import { randomInt } from 'node:crypto';

/**
 * The booking reference invariant, in one place.
 *
 * A reference is generated here and recognised here, so the two can never drift
 * apart: a second copy of the alphabet or the length somewhere else would be a
 * rule that silently stops matching the references actually in the database.
 *
 * The constants stay private. A caller that needs to know whether a string is a
 * booking reference should ask, not reimplement the question.
 */

// Unambiguous when read aloud or written down: no 0/O or 1/I.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TOKEN_LENGTH = 12;
const PREFIX = 'TPH-';

// Built from the same constants the generator uses, so the two cannot disagree.
// Anchored and exact: no trimming, no case folding, nothing before or after.
const BOOKING_REFERENCE_PATTERN = new RegExp(`^${PREFIX}[${ALPHABET}]{${TOKEN_LENGTH}}$`);

/**
 * Server-owned booking reference. `crypto.randomInt` is a CSPRNG and is
 * unbiased across the alphabet — no timestamps, counters or guest data, so a
 * reference can't be guessed from a known booking.
 */
export function generateBookingReference(): string {
  let token = '';

  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)];
  }

  return `${PREFIX}${token}`;
}

/**
 * Recognises exactly what `generateBookingReference` produces, and nothing else.
 *
 * Deliberately strict: a lowercase or space-padded reference is malformed, not
 * something to tidy up. Accepting a near-miss would mean the value a caller
 * sent and the value the database holds are no longer the same string, and the
 * lookup that follows is an exact match.
 */
export function isBookingReference(value: string): boolean {
  return BOOKING_REFERENCE_PATTERN.test(value);
}
