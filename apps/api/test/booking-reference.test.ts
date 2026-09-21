import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateBookingReference, isBookingReference } from '../src/modules/reservations/booking-reference';

// Pure: the booking-reference module imports only node:crypto.

// Every character below is drawn from the real alphabet — no 0, O, 1 or I.
const VALID = 'TPH-A2B3C4D5E6F7';

describe('generateBookingReference', () => {
  it('produces the canonical shape', () => {
    assert.match(generateBookingReference(), /^TPH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
  });

  it('produces references its own validator accepts', () => {
    // The point is that generation and validation cannot drift apart, not that
    // the output is well distributed — randomness is node:crypto's business.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const reference = generateBookingReference();

      assert.ok(isBookingReference(reference), `generated an unrecognised reference: ${reference}`);
    }
  });

  it('never emits a character that can be misread', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      assert.doesNotMatch(generateBookingReference(), /[0O1I]/);
    }
  });

  it('is 16 characters: the prefix plus a 12-character token', () => {
    assert.equal(generateBookingReference().length, 16);
  });
});

describe('isBookingReference', () => {
  it('accepts a canonical reference', () => {
    assert.equal(isBookingReference(VALID), true);
  });

  it('accepts every character of the alphabet', () => {
    // Two references between them cover all 32 symbols in token positions.
    assert.equal(isBookingReference('TPH-23456789ABCD'), true);
    assert.equal(isBookingReference('TPH-EFGHJKLMNPQR'), true);
    assert.equal(isBookingReference('TPH-STUVWXYZ2345'), true);
  });

  const invalid: [string, string][] = [
    ['lowercase', 'tph-a2b3c4d5e6f7'],
    ['a lowercase token', 'TPH-a2b3c4d5e6f7'],
    ['a lowercase prefix', 'tph-A2B3C4D5E6F7'],
    ['a mixed-case token', 'TPH-A2b3C4d5E6f7'],
    ['no prefix', 'A2B3C4D5E6F7'],
    ['a different prefix', 'ABC-A2B3C4D5E6F7'],
    ['a prefix without its hyphen', 'TPHA2B3C4D5E6F7'],
    ['a doubled prefix', 'TPH-TPH-A2B3C4D5'],
    ['a token one character short', 'TPH-A2B3C4D5E6F'],
    ['a token one character long', 'TPH-A2B3C4D5E6F7G'],
    ['a zero', 'TPH-A2B3C4D5E6F0'],
    ['a letter O', 'TPH-A2B3C4D5E6FO'],
    ['a one', 'TPH-A2B3C4D5E6F1'],
    ['a letter I', 'TPH-A2B3C4D5E6FI'],
    ['leading whitespace', ' TPH-A2B3C4D5E6F7'],
    ['trailing whitespace', 'TPH-A2B3C4D5E6F7 '],
    ['an internal space', 'TPH-A2B3 C4D5E6F7'],
    ['a trailing newline', 'TPH-A2B3C4D5E6F7\n'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a hyphen in the token', 'TPH-A2B3-C4D5E6F'],
    ['a SQL fragment', "TPH-A2B3C4D5E6F7' OR '1'='1"],
    ['a SQL comment', 'TPH-A2B3C4D5E6F7--'],
    ['a wildcard', 'TPH-A2B3C4D5E6%'],
    ['a path traversal', '../TPH-A2B3C4D5E6F7'],
    ['a URL-encoded reference', 'TPH%2DA2B3C4D5E6F7'],
    ['an HTML fragment', '<script>alert(1)</script>'],
  ];

  for (const [label, value] of invalid) {
    it(`rejects ${label}`, () => {
      assert.equal(isBookingReference(value), false, `expected ${JSON.stringify(value)} to be rejected`);
    });
  }

  it('anchors the pattern, so a valid reference inside other text is rejected', () => {
    assert.equal(isBookingReference(`prefix ${VALID}`), false);
    assert.equal(isBookingReference(`${VALID} suffix`), false);
    assert.equal(isBookingReference(`${VALID}\nTPH-A2B3C4D5E6F7`), false);
  });
});
