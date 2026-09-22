import { NextResponse } from "next/server";
import { bridgePackageList } from "@/features/packages/server/packageBridge";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await bridgePackageList();
  return NextResponse.json(result.body, { status: result.status });
}
