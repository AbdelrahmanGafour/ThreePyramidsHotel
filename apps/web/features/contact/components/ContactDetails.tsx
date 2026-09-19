import { contactInfo } from "@/features/contact/data/contactData";

const linkClass =
  "inner-focus text-[1.0625rem] font-semibold text-ink underline decoration-ink/35 underline-offset-4 transition-colors hover:text-[var(--brass-ink)] hover:decoration-[var(--brass-ink)] break-all";

// A plain, scannable list of labelled rows — phone and email are live links
// (underlined so they read as links), everything else reads as text. Sits
// beside the inquiry form inside `ContactInquirySection`.
export function ContactDetails() {
  return (
    <div>
      <h2 className="section-title">Contact details</h2>
      <dl className="mt-5 grid gap-5 border-t border-ink/15 pt-5">
        <div>
          <dt className="text-[0.9375rem] text-ink/68">Phone</dt>
          <dd className="mt-1">
            <a href={`tel:${contactInfo.phone.replace(/[\s()]/g, "")}`} className={linkClass}>
              {contactInfo.phone}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-[0.9375rem] text-ink/68">Email</dt>
          <dd className="mt-1">
            <a href={`mailto:${contactInfo.email}`} className={linkClass}>
              {contactInfo.email}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-[0.9375rem] text-ink/68">Address</dt>
          <dd className="mt-1 text-[1.0625rem] leading-[1.55] text-ink">
            {contactInfo.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </dd>
        </div>
        {contactInfo.hours.map((hour) => (
          <div key={hour.label}>
            <dt className="text-[0.9375rem] text-ink/68">{hour.label}</dt>
            <dd className="mt-1 text-[1.0625rem] font-semibold text-ink">{hour.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
