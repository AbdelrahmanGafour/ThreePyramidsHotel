import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseContactInquiryInput } from '../src/modules/contact/contact.validation';
import {
  CONTACT_INQUIRY_TYPES,
  isContactInquiryValidationError,
} from '../src/modules/contact/contact.types';

// The contact request contract, which is pure: an unknown value in, six
// checked fields out, or a throw. No database, no network, no environment.
//
// This is the only thing standing between an anonymous visitor on the open
// internet and a row in the hotel's database, so the tests lean on the
// refusals rather than the happy path: wrong types, wrong containers, unknown
// fields, over-length values, and the honeypot.

const VALID = {
  firstName: 'Amina',
  lastName: 'Khalil',
  email: 'amina@example.test',
  phone: '+20 100 000 0000',
  inquiryType: 'General inquiry',
  message: 'Do you have a room with a view of the plateau in April?',
};

/** Parses and returns the error, or fails if none was raised. */
function refusal(body: unknown): { message: string; code: string } {
  try {
    parseContactInquiryInput(body);
  } catch (error) {
    assert.ok(isContactInquiryValidationError(error), 'expected a contact validation error');

    return { message: error.message, code: error.code };
  }

  throw new assert.AssertionError({ message: 'expected the inquiry to be refused' });
}

describe('a well-formed inquiry', () => {
  it('returns exactly the six business fields', () => {
    const parsed = parseContactInquiryInput(VALID);

    assert.deepEqual(parsed, {
      firstName: 'Amina',
      lastName: 'Khalil',
      email: 'amina@example.test',
      phone: '+20 100 000 0000',
      inquiryType: 'General inquiry',
      message: 'Do you have a room with a view of the plateau in April?',
    });
    assert.deepEqual(Object.keys(parsed).sort(), [
      'email',
      'firstName',
      'inquiryType',
      'lastName',
      'message',
      'phone',
    ]);
  });

  it('accepts every inquiry type the form offers', () => {
    for (const inquiryType of CONTACT_INQUIRY_TYPES) {
      assert.equal(parseContactInquiryInput({ ...VALID, inquiryType }).inquiryType, inquiryType);
    }
  });

  it('accepts text at exactly each cap', () => {
    const parsed = parseContactInquiryInput({
      ...VALID,
      firstName: 'a'.repeat(100),
      lastName: 'b'.repeat(100),
      email: `${'c'.repeat(241)}@example.test`,
      message: 'd'.repeat(2000),
    });

    assert.equal(parsed.firstName.length, 100);
    assert.equal(parsed.email.length, 254, 'the same 254 the column allows');
    assert.equal(parsed.message.length, 2000);
  });

  it('does not mutate the body it was given', () => {
    const body = { ...VALID, phone: '  +20 100 000 0000  ', website: '' };
    const before = JSON.stringify(body);

    parseContactInquiryInput(body);

    assert.equal(JSON.stringify(body), before);
  });
});

describe('normalisation', () => {
  it('trims every string it returns', () => {
    const parsed = parseContactInquiryInput({
      firstName: '  Amina  ',
      lastName: '\tKhalil\n',
      email: '  amina@example.test ',
      phone: '  +20 100 000 0000  ',
      inquiryType: 'General inquiry',
      message: '\n  Please call me.  \n',
    });

    assert.equal(parsed.firstName, 'Amina');
    assert.equal(parsed.lastName, 'Khalil');
    assert.equal(parsed.email, 'amina@example.test');
    assert.equal(parsed.phone, '+20 100 000 0000');
    assert.equal(parsed.message, 'Please call me.');
  });

  it('measures length after trimming, not before', () => {
    // A padded name is judged on the name.
    const parsed = parseContactInquiryInput({ ...VALID, firstName: `   ${'a'.repeat(100)}   ` });

    assert.equal(parsed.firstName.length, 100);
  });

  it('leaves the inside of a message alone', () => {
    // Only the ends are trimmed: a visitor's paragraph breaks are theirs.
    const message = 'First line.\n\n  Indented second line.';
    const parsed = parseContactInquiryInput({ ...VALID, message: `  ${message}  ` });

    assert.equal(parsed.message, message);
  });

  it('does not lowercase or otherwise rewrite the email', () => {
    // The API stores what was typed; nothing here second-guesses the address.
    const parsed = parseContactInquiryInput({ ...VALID, email: 'Amina.Khalil@Example.TEST' });

    assert.equal(parsed.email, 'Amina.Khalil@Example.TEST');
  });
});

describe('required fields', () => {
  const required = ['firstName', 'lastName', 'email', 'inquiryType', 'message'] as const;

  it('refuses a missing one', () => {
    for (const field of required) {
      const body: Record<string, unknown> = { ...VALID };
      delete body[field];

      assert.equal(refusal(body).code, 'INVALID_CONTACT_INQUIRY', `${field} missing`);
    }
  });

  it('refuses a blank or whitespace-only one', () => {
    for (const field of required) {
      for (const value of ['', '   ', '\t\n ']) {
        assert.equal(
          refusal({ ...VALID, [field]: value }).code,
          'INVALID_CONTACT_INQUIRY',
          `${field} = ${JSON.stringify(value)}`,
        );
      }
    }
  });

  it('refuses one that is over its cap', () => {
    const overLength: ReadonlyArray<[string, string]> = [
      ['firstName', 'a'.repeat(101)],
      ['lastName', 'b'.repeat(101)],
      ['email', `${'c'.repeat(242)}@example.test`],
      ['message', 'd'.repeat(2001)],
    ];

    for (const [field, value] of overLength) {
      assert.equal(refusal({ ...VALID, [field]: value }).code, 'INVALID_CONTACT_INQUIRY', field);
    }
  });
});

describe('email shape', () => {
  it('refuses anything the public form would also refuse', () => {
    for (const email of [
      'not-an-email',
      'missing@domain',
      '@example.test',
      'amina@',
      'amina@@example.test',
      'amina example@test.com',
      'amina@exam ple.test',
    ]) {
      assert.equal(refusal({ ...VALID, email }).code, 'INVALID_CONTACT_INQUIRY', email);
    }
  });

  it('accepts the ordinary shapes a guest would type', () => {
    for (const email of [
      'amina@example.test',
      'amina.khalil+stay@example.co.uk',
      "o'brien@example.test",
    ]) {
      assert.equal(parseContactInquiryInput({ ...VALID, email }).email, email);
    }
  });
});

describe('the optional phone', () => {
  it('becomes null when omitted, null, or only whitespace', () => {
    // One representation of "no phone", matching the nullable column.
    for (const phone of [undefined, null, '', '   ']) {
      const body: Record<string, unknown> = { ...VALID, phone };
      if (phone === undefined) {
        delete body.phone;
      }

      assert.equal(parseContactInquiryInput(body).phone, null, JSON.stringify(phone));
    }
  });

  it('accepts the shapes the public form accepts', () => {
    for (const phone of ['+20 100 000 0000', '01001234567', '(020) 123-4567', '+44 20 7946 0958']) {
      assert.equal(parseContactInquiryInput({ ...VALID, phone }).phone, phone, phone);
    }
  });

  it('refuses fewer than seven digits', () => {
    for (const phone of ['123456', '+1 23 45', '()-. 12345']) {
      assert.equal(refusal({ ...VALID, phone }).code, 'INVALID_CONTACT_INQUIRY', phone);
    }
  });

  it('refuses letters, symbols and an over-long value', () => {
    for (const phone of ['call me maybe', '+20 100 000 0000 ext. 12', '1'.repeat(51), '+1234567890123456789012']) {
      assert.equal(refusal({ ...VALID, phone }).code, 'INVALID_CONTACT_INQUIRY', phone);
    }
  });

  it('refuses a number, because a phone number is not arithmetic', () => {
    // `+20` cannot survive being a number.
    assert.equal(refusal({ ...VALID, phone: 201000000000 }).code, 'INVALID_CONTACT_INQUIRY');
  });
});

describe('inquiry type', () => {
  it('refuses anything outside the four, including near misses', () => {
    for (const inquiryType of [
      'Wedding',
      'general inquiry',
      'ROOM RESERVATION',
      'General inquiry ',
      '',
      null,
      1,
    ]) {
      assert.equal(
        refusal({ ...VALID, inquiryType }).code,
        'INVALID_CONTACT_INQUIRY',
        JSON.stringify(inquiryType),
      );
    }
  });
});

describe('wrong types and containers', () => {
  it('refuses a body that is not a plain object', () => {
    for (const body of [null, undefined, 'text', 42, true, [], [VALID], new Date(), new Map()]) {
      assert.equal(refusal(body).code, 'INVALID_CONTACT_INQUIRY', JSON.stringify(body) ?? 'undefined');
    }
  });

  it('accepts a null-prototype object, as JSON.parse can produce', () => {
    const body = Object.assign(Object.create(null), VALID);

    assert.equal(parseContactInquiryInput(body).firstName, 'Amina');
  });

  it('refuses a non-string where a string belongs', () => {
    for (const field of ['firstName', 'lastName', 'email', 'message']) {
      for (const value of [42, true, null, {}, [], ['Amina']]) {
        assert.equal(
          refusal({ ...VALID, [field]: value }).code,
          'INVALID_CONTACT_INQUIRY',
          `${field} = ${JSON.stringify(value)}`,
        );
      }
    }
  });

  it('refuses a field nobody defined', () => {
    // A whitelist, so a column added later cannot be set from outside by a
    // request that guessed its name.
    for (const extra of ['id', 'reference', 'createdAt', 'isSpam', '__proto__x', 'admin']) {
      assert.equal(
        refusal({ ...VALID, [extra]: 'anything' }).code,
        'INVALID_CONTACT_INQUIRY',
        extra,
      );
    }
  });

  it('refuses a symbol-keyed property', () => {
    const body: Record<string | symbol, unknown> = { ...VALID };
    body[Symbol('sneaky')] = 'value';

    assert.equal(refusal(body).code, 'INVALID_CONTACT_INQUIRY');
  });
});

describe('the honeypot', () => {
  it('accepts an untouched hidden field', () => {
    // A real visitor never sees it, so it arrives absent, empty, or whitespace.
    for (const website of [undefined, null, '', '   ', '\t']) {
      const body: Record<string, unknown> = { ...VALID, website };
      if (website === undefined) {
        delete body.website;
      }

      assert.equal(parseContactInquiryInput(body).firstName, 'Amina', JSON.stringify(website));
    }
  });

  it('refuses a filled one', () => {
    for (const website of ['http://spam.example', 'anything', ' x ']) {
      assert.equal(refusal({ ...VALID, website }).code, 'INVALID_CONTACT_INQUIRY', website);
    }
  });

  it('refuses a non-string one', () => {
    // As unlike an untouched hidden input as a filled one.
    for (const website of [1, true, {}, ['x']]) {
      assert.equal(refusal({ ...VALID, website }).code, 'INVALID_CONTACT_INQUIRY', JSON.stringify(website));
    }
  });

  it('never reaches the output', () => {
    const parsed = parseContactInquiryInput({ ...VALID, website: '' });

    assert.equal('website' in parsed, false, 'a trap is not a business field');
    assert.equal(JSON.stringify(parsed).includes('website'), false);
  });

  it('says nothing about honeypots or spam', () => {
    // Telling a bot which rule caught it is telling it how to pass next time.
    const trapped = refusal({ ...VALID, website: 'http://spam.example' });
    const ordinary = refusal({ ...VALID, message: '' });

    for (const word of ['honeypot', 'spam', 'bot', 'website']) {
      assert.equal(trapped.message.toLowerCase().includes(word), false, `must not mention ${word}`);
    }
    assert.equal(trapped.code, ordinary.code, 'and is refused with the same code as anything else');
  });
});

describe('the validator reads nothing of its own', () => {
  it('touches no environment, clock, database or network', async () => {
    const { readFileSync } = await import('node:fs');

    for (const file of [
      'src/modules/contact/contact.validation.ts',
      'src/modules/contact/contact.types.ts',
    ]) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^\n]*\/\/[^\n]*$/gm, '');

      for (const forbidden of ['process.env', 'new Date', 'Date.now', 'dbPool', 'fetch(', 'console.']) {
        assert.equal(code.includes(forbidden), false, `${file} must not use ${forbidden}`);
      }
    }
  });
});
