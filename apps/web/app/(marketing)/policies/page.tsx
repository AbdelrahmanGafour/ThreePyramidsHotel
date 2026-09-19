import type { Metadata } from "next";
import { PoliciesClosing } from "@/features/policies/components/PoliciesClosing";
import { PoliciesOpening } from "@/features/policies/components/PoliciesOpening";
import { PoliciesOverview } from "@/features/policies/components/PoliciesOverview";
import { PoliciesSections } from "@/features/policies/components/PoliciesSections";

export const metadata: Metadata = {
  title: "Stay Policies | Three Pyramids Boutique Hotel",
  description: "Check-in and check-out times, cancellation windows, occupancy, and payment details for a stay at Three Pyramids Boutique Hotel.",
};

export default function PoliciesPage() {
  return (
    <main id="main-content">
      <PoliciesOpening />
      <PoliciesOverview />
      <PoliciesSections />
      <PoliciesClosing />
    </main>
  );
}
