import { NextResponse } from "next/server";
import { bridgePackageDetail } from "@/features/packages/server/packageBridge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { slug } = await context.params;
  const result = await bridgePackageDetail(slug);
  return NextResponse.json(result.body, { status: result.status });
}
