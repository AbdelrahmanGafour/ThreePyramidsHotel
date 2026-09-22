import { NextResponse } from "next/server";
import { bridgePackageReservation } from "@/features/packages/server/packageBridge";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  // Preserve malformed JSON and unknown/server-owned keys verbatim so Express
  // remains the single authority for INVALID_JSON and reservation validation.
  const result = await bridgePackageReservation(await request.text(), request.headers.get("content-type"));
  return NextResponse.json(result.body, { status: result.status });
}
