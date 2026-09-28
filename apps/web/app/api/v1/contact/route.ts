// Thin bridge adapter only. The request body is forwarded as raw text — never
// parsed into a model, never reconstructed, never inspected for contact
// fields. That is deliberate: parsing it here (e.g. via request.json()) would
// make this bridge, rather than Express, the thing that rejects malformed
// JSON, replacing Express's own INVALID_CONTACT_INQUIRY contract instead of
// preserving it.
//
// No field is added, removed, renamed or defaulted — including `website`, the
// honeypot. It has to arrive at Express exactly as the browser sent it, blank
// or filled, because Express is what decides whether a submission is real.
//
// Nothing here knows the API address: `forwardToExpress` resolves it on the
// server, so API_BASE_URL never reaches the browser bundle. No secret is read
// and no provider is contacted; accepting an inquiry only queues it.

import { NextResponse } from "next/server";
import { forwardToExpress } from "@/lib/api/proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type");

  const result = await forwardToExpress({
    method: "POST",
    path: "/api/v1/contact",
    body: rawBody,
    contentType,
  });

  if (!result.ok) {
    return NextResponse.json(result.error.toResponseBody(), { status: result.error.status });
  }

  // Express's status and body, preserved exactly — 202 with its
  // acknowledgement, or its own sanitised 400/500. One request, never retried:
  // a POST that was not answered may already have queued the inquiry.
  return NextResponse.json(result.body, { status: result.status });
}
