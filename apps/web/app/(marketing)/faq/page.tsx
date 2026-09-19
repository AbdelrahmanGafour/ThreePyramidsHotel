import type { Metadata } from "next";
import { FaqAccordion } from "@/features/faq/components/FaqAccordion";
import { FaqClosing } from "@/features/faq/components/FaqClosing";
import { FaqOpening } from "@/features/faq/components/FaqOpening";

export const metadata: Metadata = {
  title: "FAQ | Three Pyramids Boutique Hotel",
  description: "Answers to common questions about reservations, rooms, payments, arrival, and curated journeys at Three Pyramids Boutique Hotel.",
};

export default function FaqPage() {
  return (
    <main id="main-content">
      <FaqOpening />
      <FaqAccordion />
      <FaqClosing />
    </main>
  );
}
