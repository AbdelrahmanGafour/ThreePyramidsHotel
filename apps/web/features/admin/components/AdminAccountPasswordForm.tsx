import { changeAdminPasswordAction } from "../server/adminAccountActions";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { DetailSection } from "./AdminDetail";

// The password an administrator signs in with.
//
// A server component rendering a plain form, like the one above it: the shared
// submit button is the only client code, there is no client state, and the
// browser never sends a request to the API itself.
//
// Three fields, but the API contract has two. The confirmation is this
// website's own check, compared in the Server Action and then discarded — a new
// password is a value nobody can read back, so a single typo would otherwise
// become the credential and lock the account's owner out of every device at
// once. It is never sent anywhere.
//
// No field carries a `defaultValue`, and no field is a hidden input. There is
// nothing to pre-fill: a password form that remembers anything is a password
// form that has stored a password.

const CURRENT_PASSWORD_HINT = "Your existing password, to confirm this is you.";

const NEW_PASSWORD_HINT =
  "At least 9 characters and at least one digit. Spaces count, at the start and end too.";

const CONFIRM_PASSWORD_HINT =
  "The same new password again. This is checked here and is not sent to the hotel system.";

export function AdminAccountPasswordForm() {
  return (
    <DetailSection
      id="account-password"
      title="Password"
      // Says the consequence before the form is filled in, not after: being
      // signed out everywhere is the expected result here, not a failure.
      note="Changing your password signs you out on every device, including this one. You will be asked to sign in again with the new password."
    >
      <form className="adm-form" action={changeAdminPasswordAction}>
        <AdminFormField
          id="account-password-current"
          label="Current password"
          hint={CURRENT_PASSWORD_HINT}
        >
          <input
            id="account-password-current"
            name="currentPassword"
            type="password"
            className="field-control"
            autoComplete="current-password"
            required
            aria-describedby="account-password-current-hint"
          />
        </AdminFormField>

        <AdminFormField id="account-password-new" label="New password" hint={NEW_PASSWORD_HINT}>
          <input
            id="account-password-new"
            name="newPassword"
            type="password"
            className="field-control"
            autoComplete="new-password"
            // The policy's own floor, so an obviously short value is caught
            // before a round trip. The API remains authoritative: it applies
            // the same minimum and the digit rule, and this attribute can
            // never be the only thing enforcing either.
            minLength={9}
            required
            aria-describedby="account-password-new-hint"
          />
        </AdminFormField>

        <AdminFormField
          id="account-password-confirm"
          label="Confirm new password"
          hint={CONFIRM_PASSWORD_HINT}
        >
          <input
            id="account-password-confirm"
            name="confirmPassword"
            type="password"
            className="field-control"
            autoComplete="new-password"
            minLength={9}
            required
            aria-describedby="account-password-confirm-hint"
          />
        </AdminFormField>

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Changing…">
            Change password
          </AdminActionButton>
        </div>
      </form>
    </DetailSection>
  );
}
