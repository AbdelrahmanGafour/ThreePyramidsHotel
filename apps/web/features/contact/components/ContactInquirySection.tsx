import { ContactDetails } from "@/features/contact/components/ContactDetails";
import { ContactForm } from "@/features/contact/components/ContactForm";

// One section, two columns — contact details beside the inquiry form, so
// neither reads as dropped into empty space. The form gets the wider column,
// since it's the primary action here; on mobile the details come first.
export function ContactInquirySection() {
  return (
    <section
      id="inquire"
      aria-label="Contact details and inquiry form"
      className="scroll-mt-24 border-t border-ink/12 bg-ivory py-[clamp(2.5rem,5vw,3.75rem)] text-ink"
    >
      <div className="page-grid gap-y-10 lg:items-start">
        <div className="col-span-4 col-start-2 max-md:col-span-full">
          <ContactDetails />
        </div>
        <div className="col-span-6 col-start-6 max-md:col-span-full">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
