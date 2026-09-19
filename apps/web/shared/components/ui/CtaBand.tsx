import Link from "next/link";

type CtaAction = { href: string; label: string };

type CtaBandProps = {
  id?: string;
  title: string;
  text: string;
  primary: CtaAction;
  secondary?: CtaAction;
  /** Hide the actions below `lg` when a sticky bar already offers the same one. */
  hideActionsOnMobile?: boolean;
};

// The single closing prompt at the foot of a page — a plain sentence and one
// clearly-labelled primary action (plus one optional secondary). Shared so
// every page ends the same way.
export function CtaBand({ id, title, text, primary, secondary, hideActionsOnMobile }: CtaBandProps) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-ink/12 bg-limestone/55 px-[var(--page-x)] py-[clamp(2.75rem,5vw,4rem)] text-ink"
    >
      <div className="mx-auto flex max-w-[640px] flex-col items-center gap-4 text-center">
        <h2 className="section-title">{title}</h2>
        <p className="prose-body max-w-[46ch]">{text}</p>
        <div
          className={`mt-2 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center ${
            hideActionsOnMobile ? "max-lg:hidden" : ""
          }`}
        >
          <Link href={primary.href} className="btn btn-primary">
            {primary.label}
          </Link>
          {secondary ? (
            <Link href={secondary.href} className="btn btn-secondary">
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
