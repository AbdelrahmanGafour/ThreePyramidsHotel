// Thin bridge adapter only (WFI-T02). The request body is forwarded as raw
// text — never parsed into a model, never reconstructed, and never
// inspected for reservation fields. This is deliberate: parsing the body
// here (e.g. via request.json()) would make this bridge, not Express, the
// thing that rejects malformed JSON, which would replace Express's own
// INVALID_JSON and INVALID_RESERVATION validation contracts instead of
// preserving them. No field is added, removed, renamed, defaulted, or
// stripped — including the server-controlled fields Express itself already
// rejects (roomId, roomNumber, nightlyRate, nightlyRateSnapshot,
// totalAmount, currency, status, bookingReference).

import { NextResponse } from "next/server";
import { forwardToExpress } from "@/lib/api/proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type");

  const result = await forwardToExpress({
    method: "POST",
    path: "/api/v1/reservations",
    body: rawBody,
    contentType,
  });

  if (!result.ok) {
    return NextResponse.json(result.error.toResponseBody(), { status: result.error.status });
  }

  return NextResponse.json(result.body, { status: result.status });
}
