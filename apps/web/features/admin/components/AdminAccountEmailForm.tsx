import { changeAdminEmailAction } from "../server/adminAccountActions";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { DetailSection } from "./AdminDetail";

// The address an administrator signs in with.
//
// A server component rendering a plain form. The only client code involved is
// the shared submit button, which disables itself while its own form is in
// flight; there is no client state, no optimistic update, and the browser never
// sends a request to the API itself. Submitting posts to the Server Action,
// which re-reads the page afterwards, so what appears on screen is always what
// is stored.
//
// The current password is asked for because this changes the login identity and
// there is no confirmation email in this system: the password is the only proof
// that the person at the keyboard is the account's owner rather than someone who
// found it unlocked.
//
// Neither field carries a `defaultValue`. The password has none to echo, and
// the address is deliberately blank rather than pre-filled with the current
// one: a form that opens already holding the stored address invites a
// submission that changes nothing but still spends a password.

const CURRENT_PASSWORD_HINT =
  "Your existing password, to confirm this is you. It is not changed by this form.";

const EMAIL_HINT =
  "The address you will sign in with from now on. You stay signed in, and no other device is signed out.";

export function AdminAccountEmailForm({ email }: { email: string }) {
  return (
    <DetailSection
      id="account-email"
      title="Email address"
      note={`You currently sign in as ${email}.`}
    >
      <form className="adm-form" action={changeAdminEmailAction}>
        <AdminFormField
          id="account-email-current-password"
          label="Current password"
          hint={CURRENT_PASSWORD_HINT}
        >
          <input
            id="account-email-current-password"
            name="currentPassword"
            type="password"
            className="field-control"
            autoComplete="current-password"
            required
            aria-describedby="account-email-current-password-hint"
          />
        </AdminFormField>

        <AdminFormField id="account-email-new" label="New email address" hint={EMAIL_HINT}>
          <input
            id="account-email-new"
            name="email"
            type="email"
            className="field-control"
            autoComplete="email"
            // The address is data, not prose: the browser must not case-correct
            // it or offer a spelling suggestion.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={254}
            required
            aria-describedby="account-email-new-hint"
          />
        </AdminFormField>

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Saving…">
            Change email
          </AdminActionButton>
        </div>
      </form>
    </DetailSection>
  );
}
