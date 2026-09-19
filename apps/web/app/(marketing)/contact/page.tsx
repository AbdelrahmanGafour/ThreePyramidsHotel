import type { Metadata } from "next";
import { ContactClosing } from "@/features/contact/components/ContactClosing";
import { ContactInquirySection } from "@/features/contact/components/ContactInquirySection";
import { ContactLocation } from "@/features/contact/components/ContactLocation";
import { ContactOpening } from "@/features/contact/components/ContactOpening";

export const metadata: Metadata = {
  title: "Contact | Three Pyramids Boutique Hotel",
  description: "Reach Three Pyramids Boutique Hotel in Giza, find the hotel, or send an inquiry about your stay.",
};

export default function ContactPage() {
  return (
    <main id="main-content">
      <ContactOpening />
      <ContactInquirySection />
      <ContactLocation />
      <ContactClosing />
    </main>
  );
}
