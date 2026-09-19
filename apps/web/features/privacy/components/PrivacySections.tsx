import { InfoSection } from "@/shared/components/ui/InfoSection";
import { privacySections } from "@/features/privacy/data/privacyData";

// A narrow-measure article, not a legal wall of text: a plain list of links
// up top, then one titled section per topic with comfortable body text.
export function PrivacySections() {
  return (
    <>
      <InfoSection title="On this page">
        <nav aria-label="Privacy sections">
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {privacySections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inner-focus inline-flex min-h-11 items-center text-[1rem] font-semibold text-ink underline decoration-ink/35 underline-offset-4 transition-colors hover:text-[var(--brass-ink)] hover:decoration-[var(--brass-ink)]"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </InfoSection>

      {privacySections.map((section) => (
        <InfoSection key={section.id} id={section.id} title={section.title}>
          <div className="grid gap-4">
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="prose-body max-w-[65ch] text-[1.0625rem] leading-[1.75]">
                {paragraph}
              </p>
            ))}
          </div>
        </InfoSection>
      ))}
    </>
  );
}
