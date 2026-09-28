import { randomInt } from 'node:crypto';

/**
 * The contact-inquiry reference invariant, in one place.
 *
 * A reference is generated here and recognised here, so the two can never
 * drift apart — the same arrangement `reservations/booking-reference.ts` and
 * `package-reservations/booking-reference.ts` use, with the same alphabet and
 * length and a prefix of its own.
 *
 * A third copy of twelve characters is not an accident. The prefix IS the
 * identity: `isBookingReference` is deliberately exact, and teaching `TPH-` to
 * sometimes mean a contact inquiry would break the one thing those validators
 * are for. Three small modules that cannot lie about each other beat one
 * shared module that has to be told which kind it is looking at.
 *
 * ---------------------------------------------------------------------------
 * THIS REFERENCE IS INTERNAL
 *
 * It identifies the inquiry inside the outbox and is never returned to the
 * visitor. Nothing about it is secret, but nothing promises it is resolvable
 * either: with no contact table, the reference exists only for as long as its
 * outbox row does.
 */

// Unambiguous when read aloud or written down: no 0/O or 1/I.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TOKEN_LENGTH = 12;
const PREFIX = 'TPC-';

// Built from the same constants the generator uses, so the two cannot
// disagree. Anchored and exact: no trimming, no case folding.
const CONTACT_REFERENCE_PATTERN = new RegExp(`^${PREFIX}[${ALPHABET}]{${TOKEN_LENGTH}}$`);

/**
 * Server-owned contact reference.
 *
 * `crypto.randomInt` is a CSPRNG and is unbiased across the alphabet — no
 * timestamps, counters or visitor data, so one reference tells you nothing
 * about another. Pure apart from that randomness: no clock, no database, no
 * environment.
 */
export function generateContactReference(): string {
  let token = '';

  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)];
  }

  return `${PREFIX}${token}`;
}

/**
 * Recognises exactly what `generateContactReference` produces, and nothing
 * else — including a room or journey reference, which share the alphabet but
 * not the prefix.
 */
export function isContactReference(value: unknown): value is string {
  return typeof value === 'string' && CONTACT_REFERENCE_PATTERN.test(value);
}
