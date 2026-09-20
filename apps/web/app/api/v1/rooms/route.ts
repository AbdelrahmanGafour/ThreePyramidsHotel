// Thin bridge adapter only (WFI-T02). No business logic, no room
// transformation, no fallback/demo data, no caching.

import { NextResponse } from "next/server";
import { forwardToExpress } from "@/lib/api/proxy";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await forwardToExpress({ method: "GET", path: "/api/v1/rooms" });

  if (!result.ok) {
    return NextResponse.json(result.error.toResponseBody(), { status: result.error.status });
  }

  return NextResponse.json(result.body, { status: result.status });
}
