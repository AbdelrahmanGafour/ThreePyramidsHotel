import "server-only";

import {
  parsePackageDetailResponse,
  parsePackageListResponse,
  parsePublicApiError,
  type PublicPackageCard,
  type PublicPackageDetail,
} from "@/features/packages/api/contracts";
import { bridgePackageDetail, bridgePackageList, type PackageBridgeResult } from "@/features/packages/server/packageBridge";

export type PackageListLoad = { kind: "success"; packages: PublicPackageCard[] } | { kind: "unavailable" };
export type PackageDetailLoad =
  | { kind: "success"; package: PublicPackageDetail }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export function classifyPackageListResult(result: PackageBridgeResult): PackageListLoad {
  if (result.status !== 200) return { kind: "unavailable" };
  try {
    return { kind: "success", packages: parsePackageListResponse(result.body).data };
  } catch {
    return { kind: "unavailable" };
  }
}

export function classifyPackageDetailResult(result: PackageBridgeResult): PackageDetailLoad {
  if (result.status === 200) {
    try {
      return { kind: "success", package: parsePackageDetailResponse(result.body).data };
    } catch {
      return { kind: "unavailable" };
    }
  }
  if (result.status === 400 || result.status === 404) {
    try {
      const error = parsePublicApiError(result.body).error;
      if (
        (result.status === 400 && error.code === "INVALID_PACKAGE_SLUG") ||
        (result.status === 404 && error.code === "PACKAGE_NOT_FOUND")
      ) {
        return { kind: "not_found" };
      }
    } catch {
      // Malformed upstream errors are not proof that a package is absent.
    }
  }
  return { kind: "unavailable" };
}

export async function loadPublicPackages(): Promise<PackageListLoad> {
  return classifyPackageListResult(await bridgePackageList());
}

export async function loadPublicPackage(slug: string): Promise<PackageDetailLoad> {
  return classifyPackageDetailResult(await bridgePackageDetail(slug));
}
