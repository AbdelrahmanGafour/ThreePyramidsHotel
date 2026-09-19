import type { Metadata } from "next";
import { PrivacyOpening } from "@/features/privacy/components/PrivacyOpening";
import { PrivacySections } from "@/features/privacy/components/PrivacySections";

export const metadata: Metadata = {
  title: "Privacy | Three Pyramids Boutique Hotel",
  description: "How Three Pyramids Boutique Hotel handles information shared through a reservation or an inquiry.",
};

export default function PrivacyPage() {
  return (
    <main id="main-content">
      <PrivacyOpening />
      <PrivacySections />
    </main>
  );
}
