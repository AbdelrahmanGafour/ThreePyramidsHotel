import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  describeAdminEmailProblem,
  describeAdminPasswordProblem,
  isValidAdminEmail,
  isValidAdminPassword,
  normalizeAdminEmail,
} from '../src/modules/admin-auth/admin-auth.policy';
import {
  INVALID_ADMIN_ACCOUNT_UPDATE_ERROR_CODE,
  isAdminAccountUpdateValidationError,
} from '../src/modules/admin-auth/admin-auth.types';
import {
  parseAdminEmailChangeInput,
  parseAdminLoginInput,
  parseAdminPasswordChangeInput,
} from '../src/modules/admin-auth/admin-auth.validation';

// Pure: the policy and the two account parsers import no database code.
// Whether an address is already taken needs another row, and whether a
// password is the current one needs the stored hash — neither is a question
// a pure function can answer, and neither is asked here.

const VALID_PASSWORD = 'correct horse 9';
const VALID_EMAIL = 'manager@example.com';

function assertRejected(parse: () => unknown, label: string): void {
  assert.throws(
    parse,
    (error: unknown) => {
      assert.ok(
        isAdminAccountUpdateValidationError(error),
        `expected an account update error for ${label}, got: ${String(error)}`,
      );
      assert.equal(error.code, INVALID_ADMIN_ACCOUNT_UPDATE_ERROR_CODE);
      return true;
    },
    `expected ${label} to be rejected`,
  );
}

const rejectEmail = (body: unknown, label: string) =>
  assertRejected(() => parseAdminEmailChangeInput(body), label);
const rejectPassword = (body: unknown, label: string) =>
  assertRejected(() => parseAdminPasswordChangeInput(body), label);

// ---------------------------------------------------------------------------
// The shared policy
// ---------------------------------------------------------------------------

describe('normalizeAdminEmail', () => {
  it('trims and lowercases, matching how accounts are stored', () => {
    assert.equal(normalizeAdminEmail('  Manager@Example.COM  '), 'manager@example.com');
    assert.equal(normalizeAdminEmail('ALREADY@LOWER.COM'), 'already@lower.com');
  });

  it('leaves an already-normalised address alone', () => {
    assert.equal(normalizeAdminEmail(VALID_EMAIL), VALID_EMAIL);
  });
});

describe('the shared email rules', () => {
  it('accepts an ordinary address', () => {
    assert.equal(describeAdminEmailProblem(VALID_EMAIL), null);
    assert.equal(isValidAdminEmail(VALID_EMAIL), true);
  });

  for (const [label, email] of [
    ['blank', ''],
    ['no @', 'manager.example.com'],
    ['two @', 'man@ager@example.com'],
    ['nothing before the @', '@example.com'],
    ['no domain', 'manager@'],
    ['a dotless domain', 'manager@example'],
    ['a leading dot', 'manager@.example.com'],
    ['a trailing dot', 'manager@example.com.'],
    ['an empty domain part', 'manager@example..com'],
    ['a hyphen-led label', 'manager@-example.com'],
    ['a hyphen-tailed label', 'manager@example-.com'],
    ['an underscore in the domain', 'manager@exa_mple.com'],
    ['an internal space', 'man ager@example.com'],
    ['a tab', 'manager@exa\tmple.com'],
    ['over 254 characters', `${'a'.repeat(250)}@example.com`],
    ['a local part over 64 characters', `${'a'.repeat(65)}@example.com`],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.notEqual(describeAdminEmailProblem(email), null, label);
      assert.equal(isValidAdminEmail(email), false);
    });
  }

  it('reports a reason that reads after a subject, for the seed to print', () => {
    // `admin:create` prints `ADMIN_EMAIL ${reason}`, so each reason has to be
    // a sentence fragment rather than a whole sentence.
    const reason = describeAdminEmailProblem('manager@example');
    assert.equal(reason, 'domain must contain a dot, for example example.com');
  });
});

describe('the shared password policy', () => {
  it('requires at least nine characters', () => {
    assert.equal(MIN_ADMIN_PASSWORD_LENGTH, 9);
    assert.notEqual(describeAdminPasswordProblem('short1'), null);
    assert.notEqual(describeAdminPasswordProblem('12345678'), null, 'eight is not enough');
    assert.equal(describeAdminPasswordProblem('123456789'), null, 'nine is');
  });

  it('requires at least one ASCII digit', () => {
    assert.notEqual(describeAdminPasswordProblem('no digits here'), null);
    assert.equal(describeAdminPasswordProblem('one digit 7'), null);
  });

  it('does not accept a non-ASCII digit as a digit', () => {
    // The rule is /[0-9]/, and an Arabic-Indic numeral is not one of those.
    assert.notEqual(describeAdminPasswordProblem('passwordy٩'), null);
  });

  it('never trims: spaces count towards the length and stay part of the value', () => {
    assert.equal(describeAdminPasswordProblem('  1  2  3'), null, 'nine characters including spaces');
    assert.equal(isValidAdminPassword('        9'), true);
  });

  it('quotes no password in the reason it gives', () => {
    for (const password of ['short1', 'no digits here']) {
      const reason = describeAdminPasswordProblem(password);
      assert.ok(reason);
      assert.ok(!reason.includes(password), 'a rule must not echo the secret it refused');
    }
  });
});

describe('login still refuses the password policy', () => {
  it('accepts a short, digitless password at sign-in', () => {
    // An account created under an older policy still has to be able to sign
    // in, and rejecting early would say something about the stored password.
    const parsed = parseAdminLoginInput({ email: VALID_EMAIL, password: 'x' });

    assert.equal(parsed.password, 'x');
    assert.equal(parsed.email, VALID_EMAIL);
  });
});

// ---------------------------------------------------------------------------
// parseAdminEmailChangeInput
// ---------------------------------------------------------------------------

describe('parseAdminEmailChangeInput', () => {
  it('accepts exactly { currentPassword, email }', () => {
    assert.deepEqual(
      parseAdminEmailChangeInput({ currentPassword: VALID_PASSWORD, email: VALID_EMAIL }),
      { currentPassword: VALID_PASSWORD, email: VALID_EMAIL },
    );
  });

  it('normalises the address and leaves the password untouched', () => {
    const parsed = parseAdminEmailChangeInput({
      currentPassword: '  spaced 1  ',
      email: '  Manager@Example.COM  ',
    });

    assert.equal(parsed.email, 'manager@example.com');
    assert.equal(parsed.currentPassword, '  spaced 1  ', 'a password is never trimmed');
  });

  it('returns a fresh object holding only the two fields', () => {
    const body = { currentPassword: VALID_PASSWORD, email: VALID_EMAIL };
    const parsed = parseAdminEmailChangeInput(body);

    assert.notEqual(parsed, body);
    assert.deepEqual(Object.keys(parsed).sort(), ['currentPassword', 'email']);
  });

  it('accepts a null-prototype object, which JSON.parse can produce', () => {
    const body = Object.assign(Object.create(null), {
      currentPassword: VALID_PASSWORD,
      email: VALID_EMAIL,
    });

    assert.equal(parseAdminEmailChangeInput(body).email, VALID_EMAIL);
  });

  describe('rejects a missing key', () => {
    it('no currentPassword', () => {
      rejectEmail({ email: VALID_EMAIL }, 'email only');
    });

    it('no email', () => {
      rejectEmail({ currentPassword: VALID_PASSWORD }, 'password only');
    });

    it('an empty object', () => {
      rejectEmail({}, 'empty');
    });

    it('an empty currentPassword', () => {
      rejectEmail({ currentPassword: '', email: VALID_EMAIL }, 'blank password');
    });
  });

  describe('rejects an extra key', () => {
    for (const [label, extra] of [
      ['an unknown key', { reason: 'moving house' }],
      ['a target account', { adminUserId: '7' }],
      ['a second identity', { id: 1 }],
      ['displayName', { displayName: 'Someone Else' }],
      ['newPassword, which belongs to the other endpoint', { newPassword: 'another 99' }],
      ['isActive', { isActive: true }],
    ] as const) {
      it(label, () => {
        rejectEmail({ currentPassword: VALID_PASSWORD, email: VALID_EMAIL, ...extra }, label);
      });
    }

    it('a swapped key, so length alone cannot let a body through', () => {
      rejectEmail({ currentPassword: VALID_PASSWORD, mail: VALID_EMAIL }, 'mail instead of email');
    });
  });

  describe('rejects a body that is not a plain object', () => {
    for (const [label, body] of [
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ currentPassword: VALID_PASSWORD, email: VALID_EMAIL }]],
      ['a string', 'currentPassword=x'],
      ['a number', 7],
      ['a boolean', true],
      ['a Date', new Date()],
      ['a Map', new Map()],
    ] as const) {
      it(label, () => {
        rejectEmail(body, label);
      });
    }
  });

  describe('rejects a malformed address', () => {
    for (const email of ['not-an-email', 'a@b', '@example.com', 'manager@', 'man ager@example.com']) {
      it(email || '(blank)', () => {
        rejectEmail({ currentPassword: VALID_PASSWORD, email }, email);
      });
    }

    it('a non-string email', () => {
      rejectEmail({ currentPassword: VALID_PASSWORD, email: 42 }, 'numeric email');
    });
  });

  it('never puts a submitted value in the error it raises', () => {
    assert.throws(
      () => parseAdminEmailChangeInput({ currentPassword: 'hunter 42', email: 'nope' }),
      (error: unknown) => {
        assert.ok(isAdminAccountUpdateValidationError(error));
        assert.ok(!error.message.includes('hunter 42'));
        assert.ok(!error.message.includes('nope'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// parseAdminPasswordChangeInput
// ---------------------------------------------------------------------------

describe('parseAdminPasswordChangeInput', () => {
  it('accepts exactly { currentPassword, newPassword }', () => {
    assert.deepEqual(
      parseAdminPasswordChangeInput({ currentPassword: 'old value 1', newPassword: 'new value 2' }),
      { currentPassword: 'old value 1', newPassword: 'new value 2' },
    );
  });

  it('trims neither value', () => {
    const parsed = parseAdminPasswordChangeInput({
      currentPassword: '  old 1  ',
      newPassword: '  new 2  ',
    });

    assert.equal(parsed.currentPassword, '  old 1  ');
    assert.equal(parsed.newPassword, '  new 2  ');
  });

  it('counts surrounding spaces towards the new password length', () => {
    // Nine characters, all but one of them spaces. Trimming would have made
    // this a one-character password and a different secret.
    assert.equal(parseAdminPasswordChangeInput({
      currentPassword: 'old value 1',
      newPassword: '        9',
    }).newPassword, '        9');
  });

  it('returns a fresh object holding only the two fields', () => {
    const body = { currentPassword: 'old value 1', newPassword: 'new value 2' };
    const parsed = parseAdminPasswordChangeInput(body);

    assert.notEqual(parsed, body);
    assert.deepEqual(Object.keys(parsed).sort(), ['currentPassword', 'newPassword']);
  });

  describe('applies the password policy to the NEW password only', () => {
    it('rejects a new password under nine characters', () => {
      rejectPassword({ currentPassword: 'old value 1', newPassword: 'short1' }, 'short');
    });

    it('rejects a new password with no digit', () => {
      rejectPassword({ currentPassword: 'old value 1', newPassword: 'no digits here' }, 'digitless');
    });

    it('accepts a current password that would fail the policy', () => {
      // The stored one may predate the policy; only the new value is governed.
      const parsed = parseAdminPasswordChangeInput({
        currentPassword: 'x',
        newPassword: 'new value 2',
      });

      assert.equal(parsed.currentPassword, 'x');
    });
  });

  describe('rejects a missing key', () => {
    for (const [label, body] of [
      ['no newPassword', { currentPassword: 'old value 1' }],
      ['no currentPassword', { newPassword: 'new value 2' }],
      ['an empty object', {}],
      ['an empty currentPassword', { currentPassword: '', newPassword: 'new value 2' }],
      ['a non-string newPassword', { currentPassword: 'old value 1', newPassword: 9 }],
    ] as const) {
      it(label, () => {
        rejectPassword(body, label);
      });
    }
  });

  describe('rejects an extra key', () => {
    for (const [label, extra] of [
      ['an unknown key', { reason: 'rotation' }],
      ['a target account', { adminUserId: '7' }],
      ['email, which belongs to the other endpoint', { email: VALID_EMAIL }],
      ['a confirmation field the server does not own', { confirmPassword: 'new value 2' }],
    ] as const) {
      it(label, () => {
        rejectPassword(
          { currentPassword: 'old value 1', newPassword: 'new value 2', ...extra },
          label,
        );
      });
    }
  });

  describe('rejects a body that is not a plain object', () => {
    for (const [label, body] of [
      ['null', null],
      ['undefined', undefined],
      ['an array', []],
      ['a string', 'x'],
      ['a number', 1],
    ] as const) {
      it(label, () => {
        rejectPassword(body, label);
      });
    }
  });

  it('never puts a submitted password in the error it raises', () => {
    assert.throws(
      () => parseAdminPasswordChangeInput({ currentPassword: 'hunter 42', newPassword: 'weak' }),
      (error: unknown) => {
        assert.ok(isAdminAccountUpdateValidationError(error));
        assert.ok(!error.message.includes('hunter 42'));
        assert.ok(!error.message.includes('weak'));
        return true;
      },
    );
  });
});
