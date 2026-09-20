import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { AdminUnavailable } from "@/features/admin/components/AdminUnavailable";
import { getCurrentAdminSession } from "@/features/admin/server/currentAdminSession";
import "@/features/admin/admin.css";

// The gate for the whole administration area.
//
// Every /admin route renders inside this layout, so every future section —
// reservations, rooms, settings — inherits this check without repeating it.
// The check runs on the server against Express before any dashboard markup is
// produced, and it is authoritative: there is no client-side equivalent, and
// nothing here decides authentication on its own.

export const metadata: Metadata = {
  title: {
    default: "Administration | Three Pyramids",
    template: "%s | Three Pyramids Administration",
  },
  description: "Hotel administration for Three Pyramids Boutique Hotel.",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentAdminSession();

  // Only an explicit answer from the API sends anyone to sign in. Deliberately
  // not wrapped in try/catch: redirect() works by throwing.
  if (session.state === "unauthenticated") {
    redirect("/admin/login");
  }

  // The API could not answer. Being unable to confirm a session is not the same
  // as being signed out, so this must not redirect — that would bounce a
  // signed-in administrator to a login page that cannot work either.
  if (session.state === "unavailable") {
    return <AdminUnavailable reason={session.reason} />;
  }

  return <AdminShell administrator={session.administrator}>{children}</AdminShell>;
}
