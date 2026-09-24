// Thin bridge adapter only (WFI-T02). The dynamic segment is encoded for
// transport safety only (so it cannot alter the outbound URL's structure) —
// it is never business-validated or rewritten here. Unknown/inactive slug
// handling remains Express's responsibility.

import { NextResponse } from "next/server";
import { forwardToExpress } from "@/lib/api/proxy";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { slug } = await context.params;
  const safeSlug = encodeURIComponent(slug);

  const result = await forwardToExpress({ method: "GET", path: `/api/v1/rooms/${safeSlug}` });

  if (!result.ok) {
    return NextResponse.json(result.error.toResponseBody(), { status: result.error.status });
  }

  return NextResponse.json(result.body, { status: result.status });
}
