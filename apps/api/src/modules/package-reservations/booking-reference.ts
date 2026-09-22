import { randomInt } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 12;
const PREFIX = 'TPP-';
const PATTERN = new RegExp(`^${PREFIX}[${ALPHABET}]{${LENGTH}}(?![\\s\\S])`);

export function generatePackageBookingReference(): string {
  let token = '';
  for (let i = 0; i < LENGTH; i += 1) token += ALPHABET[randomInt(ALPHABET.length)];
  return PREFIX + token;
}

export function isPackageBookingReference(value: unknown): value is string {
  return typeof value === 'string' && PATTERN.test(value);
}
