// Thin bridge adapter only (WFI-T02). The query string is forwarded exactly
// as received — no date validation, number coercion, defaulting, renaming,
// or capacity interpretation happens here. Express remains the sole source
// of truth for what a valid availability query is.

import { NextResponse } from "next/server";
import { forwardToExpress } from "@/lib/api/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const result = await forwardToExpress({
    method: "GET",
    path: "/api/v1/availability",
    searchParams,
  });

  if (!result.ok) {
    return NextResponse.json(result.error.toResponseBody(), { status: result.error.status });
  }

  return NextResponse.json(result.body, { status: result.status });
}
