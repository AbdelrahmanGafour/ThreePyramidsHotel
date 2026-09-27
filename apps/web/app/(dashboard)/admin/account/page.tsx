import type { Metadata } from "next";
import { AdminAccountEmailForm } from "@/features/admin/components/AdminAccountEmailForm";
import { AdminAccountPasswordForm } from "@/features/admin/components/AdminAccountPasswordForm";
import { DetailMasthead, DetailPage } from "@/features/admin/components/AdminDetail";
import {
  ADMIN_ACCOUNT_NOTICES,
  parseAdminAccountNoticeToken,
} from "@/features/admin/lib/adminAccount";
import { getCurrentAdminSession } from "@/features/admin/server/currentAdminSession";

// The administrator's own account: the address they sign in with, and the
// password.
//
// A server component. Both panels are plain forms posting to Server Actions,
// so no password ever leaves the browser for anywhere but this app's own
// server, and the API's address is never in the bundle.
//
// Who the account belongs to is not read from the URL or from a prop: it comes
// from the session the layout already verified, through the same memoised
// helper the shell uses. There is no account id anywhere on this page, and no
// way to point it at somebody else's account.
//
// Display name is deliberately absent. It is a third mutable field with its
// own consequences, and this page changes only the two credentials.
//
// The session guard lives in the admin layout; this page does not repeat it.
// The one case it does handle is an API that stopped answering between the
// layout's read and this one — being unable to confirm who you are is not the
// same as being signed out, so it reports that rather than redirecting.

export const metadata: Metadata = { title: "My account" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminAccountPage({ searchParams }: PageProps) {
  // A fixed token from a closed set, used only to pick one prepared message.
  // Nothing from the URL is rendered as text, so no submitted address — and
  // certainly no password — can reach the page through a query parameter.
  const token = parseAdminAccountNoticeToken(await searchParams, ADMIN_ACCOUNT_NOTICES);
  const notice = token ? ADMIN_ACCOUNT_NOTICES[token] : null;

  // Memoised per request: the layout asked the same question, and both get the
  // one answer from the one call to the API.
  const session = await getCurrentAdminSession();

  // Deliberately no redirect on `unauthenticated` either: the layout wrapping
  // this page already made that decision and would have redirected before any
  // of this rendered. Reaching here without a session means the answer changed
  // mid-render, which is an unavailable system rather than a sign-out.
  if (session.state !== "authenticated") {
    // An in-shell panel, not `AdminUnavailable`: that component renders its own
    // `.adm` shell and this page already sits inside one.
    return (
      <section className="adm-panel" aria-labelledby="account-unavailable-title">
        <div className="adm-panel-head">
          <h1 id="account-unavailable-title" className="adm-panel-title">
            Your account is unavailable
          </h1>
          <p className="adm-panel-note">
            {session.state === "unavailable"
              ? session.reason
              : "Your session could not be confirmed."}{" "}
            Reload the page in a moment; if it keeps failing, contact the hotel&rsquo;s system
            administrator.
          </p>
        </div>
      </section>
    );
  }

  const { administrator } = session;

  return (
    <>
      {notice ? (
        <p className="adm-notice" data-tone={notice.tone} role="status">
          {notice.message}
        </p>
      ) : null}

      <DetailPage>
        <DetailMasthead
          title="My account"
          meta={[
            <span key="email">{administrator.email}</span>,
            <span key="name">{administrator.displayName}</span>,
          ]}
        />

        <AdminAccountEmailForm email={administrator.email} />
        <AdminAccountPasswordForm />
      </DetailPage>
    </>
  );
}
