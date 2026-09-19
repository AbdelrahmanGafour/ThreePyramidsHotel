import { Breadcrumb } from "@/shared/components/ui/Breadcrumb";
import type { Package } from "@/features/packages/types";

export function PackageBreadcrumb({ pkg }: { pkg: Package }) {
  return <Breadcrumb parent={{ href: "/packages", label: "All journeys" }} current={pkg.shortTitle} />;
}
