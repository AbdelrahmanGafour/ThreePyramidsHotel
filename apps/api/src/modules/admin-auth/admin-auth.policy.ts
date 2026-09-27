// What a staff account's email and password are allowed to be.
//
// One implementation, three callers: the login validator, the `admin:create`
// seed, and the account-settings endpoints. Before this file the email rules
// existed twice — in `admin-auth.validation.ts` and in `db/seeds/admin.ts` —
// and agreed only by careful copying. Two copies of a rule that decides what
// can be stored is a rule that will eventually disagree with itself.
//
// Each check returns a *reason* rather than throwing, because the three
// callers need different things from the same rules: login reports one
// deliberately vague message (which field was wrong is not a caller's
// business), the seed prints the specific rule to an operator fixing an
// environment variable, and the account endpoint answers with its own locked
// body. A shared thrower would have forced one of those to be wrong.
//
// Nothing here logs, and no password value is ever put in a returned string.

/** Practical limits, not RFC 5322. They catch malformed addresses, never typos. */
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * The form an address is stored in.
 *
 * `admin_users` carries CHECK constraints for `email = lower(email)` and
 * `email = btrim(email)`, so an unnormalised value does not conflict — it
 * raises. Normalising here, in the one place every writer goes through, is
 * what keeps those constraints a backstop rather than an error path.
 */
export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Why this address cannot be stored, or `null` if it can.
 *
 * Every reason is phrased to read after a subject, so the seed can print
 * `ADMIN_EMAIL ${reason}` and keep the per-rule wording it had.
 *
 * Expects an already-normalised value: the whitespace rule below would
 * otherwise reject an address that trimming was about to make valid.
 */
export function describeAdminEmailProblem(email: string): string | null {
  if (email.length === 0) {
    return 'must not be blank';
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return `must be ${MAX_EMAIL_LENGTH} characters or fewer`;
  }
  if (/\s/.test(email)) {
    return 'must not contain spaces';
  }

  const parts = email.split('@');

  if (parts.length !== 2) {
    return 'must contain exactly one @';
  }

  const [localPart = '', domain = ''] = parts;

  if (localPart.length === 0) {
    return 'must have something before the @';
  }
  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    return `must have ${MAX_LOCAL_PART_LENGTH} characters or fewer before the @`;
  }
  if (domain.length === 0) {
    return 'must have a domain after the @';
  }
  if (!domain.includes('.')) {
    return 'domain must contain a dot, for example example.com';
  }
  if (domain.startsWith('.') || domain.endsWith('.')) {
    return 'domain must not start or end with a dot';
  }

  for (const label of domain.split('.')) {
    if (label.length === 0) {
      return 'domain must not contain an empty part';
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return 'domain parts must not start or end with a hyphen';
    }
    if (!DOMAIN_LABEL_PATTERN.test(label)) {
      return 'domain may contain only letters, digits and hyphens';
    }
  }

  return null;
}

/** True when the address passes every rule above. */
export function isValidAdminEmail(email: string): boolean {
  return describeAdminEmailProblem(email) === null;
}

// ---------------------------------------------------------------------------
// Password policy
//
// Length plus at least one digit. No case or symbol rules, which push people
// towards shorter, more predictable passwords.
//
// This policy governs what a password may BECOME — creating an account and
// changing one. It is deliberately NOT applied to a login attempt: an account
// created under an older policy still has to be able to sign in, and checking
// a submitted password against the policy before verifying it would tell an
// attacker something about the stored one.
// ---------------------------------------------------------------------------

export const MIN_ADMIN_PASSWORD_LENGTH = 9;

const DIGIT_PATTERN = /[0-9]/;

/**
 * Why this password cannot be set, or `null` if it can.
 *
 * The value is never trimmed and never appears in the returned reason:
 * leading and trailing spaces are part of a password, and a rule explaining
 * itself must not quote the secret it rejected.
 */
export function describeAdminPasswordProblem(password: string): string | null {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`;
  }
  if (!DIGIT_PATTERN.test(password)) {
    return 'must contain at least one digit (0-9)';
  }

  return null;
}

/** True when the password satisfies the policy above. */
export function isValidAdminPassword(password: string): boolean {
  return describeAdminPasswordProblem(password) === null;
}
