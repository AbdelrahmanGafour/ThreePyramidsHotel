import Link from "next/link";

type BreadcrumbProps = {
  parent: { href: string; label: string };
  current: string;
};

// Sits directly under the fixed header on detail pages. The parent is a real,
// underlined link (with a back arrow) so "how do I go back?" never needs
// guessing; the current page is plain text marked aria-current.
export function Breadcrumb({ parent, current }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="stone-section pt-[calc(var(--header-h)+clamp(1.25rem,2.5vw,1.75rem))]"
    >
      <div className="page-grid">
        <ol className="col-span-10 col-start-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.9375rem] text-ink/75 max-md:col-span-full">
          <li>
            <Link href={parent.href} className="inner-focus inline-flex min-h-11 items-center gap-1.5 font-semibold text-ink underline decoration-ink/35 underline-offset-4 transition-colors hover:text-[var(--brass-ink)] hover:decoration-[var(--brass-ink)]">
              <span aria-hidden="true">&larr;</span>
              {parent.label}
            </Link>
          </li>
          <li aria-hidden="true" className="text-ink/40">
            /
          </li>
          <li aria-current="page">{current}</li>
        </ol>
      </div>
    </nav>
  );
}
