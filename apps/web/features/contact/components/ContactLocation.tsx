import { contactInfo } from "@/features/contact/data/contactData";

// A real, accessible map embed beside the address and a plainly-labelled
// directions link. The grayscale/contrast filter keeps the map tiles from
// clashing with the warm stone palette used everywhere else on the page.
export function ContactLocation() {
  return (
    <section
      aria-labelledby="location-title"
      className="border-t border-ink/12 bg-limestone/45 py-[clamp(2.5rem,5vw,3.75rem)] text-ink"
    >
      <div className="page-grid items-start gap-y-8">
        <div className="col-span-4 col-start-2 max-md:col-span-full">
          <h2 id="location-title" className="section-title">
            Find us
          </h2>
          <p className="prose-body mt-2 max-w-[36ch]">{contactInfo.shortDirectionsNote}</p>

          <address className="mt-5 border-t border-ink/15 pt-4 text-[1.0625rem] leading-[1.55] text-ink not-italic">
            {contactInfo.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>

          <a
            href={contactInfo.mapsDirectionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary mt-6 w-full sm:w-auto"
          >
            Get directions in Google Maps<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>

        <div className="col-span-6 col-start-6 max-md:col-span-full">
          <div className="relative aspect-[4/3] overflow-hidden border border-ink/20 bg-chocolate">
            <iframe
              title={`Map of Three Pyramids Boutique Hotel — ${contactInfo.addressLines.join(", ")}`}
              src={contactInfo.mapsEmbedUrl}
              className="absolute inset-0 h-full w-full grayscale-[20%] contrast-[1.05] saturate-[0.85]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
