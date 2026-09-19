import { InfoSection } from "@/shared/components/ui/InfoSection";

const points = [
  { label: "Planned around you", copy: "Routes are paced around light and time of day, not around ticking off stops." },
  { label: "Private guidance", copy: "A guide arranged around your morning, not a fixed departure board." },
  { label: "One point of contact", copy: "The hotel that holds your room also arranges the route around it." },
];

// Three plain statements consistent with the hotel's own voice — not
// testimonials and not invented claims.
export function PackagesTrustBand() {
  return (
    <InfoSection title="How our journeys work">
      <ul className="grid gap-6">
        {points.map((point) => (
          <li key={point.label} className="border-t border-ink/12 pt-4 first:border-t-0 first:pt-0">
            <h3 className="text-[1.0625rem] font-semibold text-ink">{point.label}</h3>
            <p className="prose-body mt-1">{point.copy}</p>
          </li>
        ))}
      </ul>
    </InfoSection>
  );
}
