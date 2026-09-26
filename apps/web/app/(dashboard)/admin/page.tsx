import type { Metadata } from "next";
import { AdminOverview } from "@/features/admin/components/AdminOverview";
import { getCurrentAdminSession } from "@/features/admin/server/currentAdminSession";

// The admin landing page.
//
// It reads the session only to know who to greet. That read is the same one
// the protected layout already made: `getCurrentAdminSession` is memoised per
// request, so rendering this page adds no call to the API.
//
// The layout has already turned an unauthenticated session into a redirect
// and an unreachable API into the outage screen, so by the time this renders
// the session is authenticated. It is still read as a result rather than
// assumed, because a greeting is not worth throwing over.

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const session = await getCurrentAdminSession();

  return (
    <AdminOverview
      displayName={session.state === "authenticated" ? session.administrator.displayName : null}
    />
  );
}
