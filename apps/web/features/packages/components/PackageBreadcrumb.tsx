import { Breadcrumb } from "@/shared/components/ui/Breadcrumb";
import type { PublicPackageDetail } from "@/features/packages/api/contracts";

export function PackageBreadcrumb({ pkg }: { pkg: PublicPackageDetail }) {
  return <Breadcrumb parent={{ href: "/packages", label: "All journeys" }} current={pkg.title} />;
}
