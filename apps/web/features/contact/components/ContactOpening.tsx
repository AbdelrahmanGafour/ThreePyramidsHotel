import Link from "next/link";
import { PageOpening } from "@/shared/components/ui/PageOpening";
import { contactInfo } from "@/features/contact/data/contactData";

// Compact and text-only — Contact is a utility page. The lead sentence lists
// every way to reach the hotel, and the two buttons are the two quickest.
export function ContactOpening() {
  return (
    <PageOpening
      eyebrow="Contact"
      title="Contact the hotel"
      actions={
        <>
          <Link href="#inquire" className="btn btn-primary">
            Send an inquiry
          </Link>
          <a href={`tel:${contactInfo.phone.replace(/[\s()]/g, "")}`} className="btn btn-secondary">
            Call {contactInfo.phone}
          </a>
        </>
      }
    >
      You can call, email, visit, or send an inquiry. Choose whichever is easiest for you.
    </PageOpening>
  );
}
