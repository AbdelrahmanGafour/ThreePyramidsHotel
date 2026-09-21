import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/shared/components/ui/BrandMark";
import { AdminLoginForm } from "@/features/admin/components/AdminLoginForm";
import { getCurrentAdminSession } from "@/features/admin/server/currentAdminSession";
import "@/features/admin/admin-login.css";

// Sign-in lives in its own route group, outside (dashboard): the admin layout
// there requires a session, and the one page that exists to obtain a session
// must not sit behind that requirement. It runs the same authoritative check
// against Express, and draws the opposite conclusion from it.

export const metadata: Metadata = {
  title: "Staff sign in | Three Pyramids Administration",
  description: "Sign in to Three Pyramids Boutique Hotel administration.",
  robots: { index: false, follow: false },
};

function LoginCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="adml">
      <div className="adml-card">
        <div className="adml-brand">
          <BrandMark className="adml-brand-mark" />
          <div>
            <p className="adml-brand-name">Three Pyramids</p>
            <p className="adml-brand-sub">Boutique Hotel, Giza</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function AdminLoginPage() {
  const session = await getCurrentAdminSession();

  // Only an explicit, confirmed session skips the form. Deliberately outside
  // any try/catch: redirect() works by throwing.
  if (session.state === "authenticated") {
    redirect("/admin");
  }

  // The API could not answer, so there is nothing to sign in against. Showing
  // the form would invite a sign-in that cannot succeed and would read as a
  // credential problem when it is not one.
  if (session.state === "unavailable") {
    return (
      <LoginCard>
        <header className="adml-head">
          <p className="eyebrow">Staff administration</p>
          <h1 className="adml-title">Sign in unavailable</h1>
        </header>

        <p className="adml-alert" data-tone="unavailable" data-standalone="true" role="status">
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M10 2.75 17.75 16.5H2.25z" strokeLinejoin="round" />
            <path d="M10 7.75v3.5M10 13.75h.01" />
          </svg>
          <span>The hotel system is temporarily unavailable. Please try again in a moment.</span>
        </p>

        <p className="adml-foot">
          {session.reason} If this continues, contact the hotel’s system administrator — the
          reservation system itself may be down.
        </p>
      </LoginCard>
    );
  }

  return (
    <LoginCard>
      <header className="adml-head">
        <p className="eyebrow">Staff administration</p>
        <h1 className="adml-title">Sign in</h1>
        <p className="adml-lede">
          This area is for hotel staff. Use the account issued to you by the hotel.
        </p>
      </header>

      <AdminLoginForm />

      <p className="adml-foot">
        Need access or locked out? Contact the hotel’s system administrator — accounts are
        created and reset by them.
      </p>
    </LoginCard>
  );
}
