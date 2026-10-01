"use client";

import { useState } from "react";
import { faqCategories } from "@/features/faq/data/faqData";

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// A calmer accordion than a "many open at once" pattern: only one answer is
// expanded across the whole page at a time, tracked by a single key rather
// than per-category state, so opening a question in one category quietly
// closes whatever was open elsewhere. Each question is a full-width button
// with a bordered +/− control, and the open row is tinted with a brass edge.
export function FaqAccordion() {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <section className="border-t border-ink/12 bg-ivory py-[clamp(2.25rem,4.5vw,3.5rem)] text-ink">
      <div className="page-grid">
        <nav aria-label="FAQ topics" className="col-span-10 col-start-2 mb-10 max-md:col-span-full">
          <p className="text-[0.9375rem] font-semibold text-ink">Jump to a topic</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {faqCategories.map((category) => (
              <li key={category.name}>
                <a
                  href={`#${slugify(category.name)}`}
                  className="inner-focus inline-flex min-h-11 items-center border border-ink/35 px-4 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-ink hover:text-ivory!"
                >
                  {category.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="col-span-10 col-start-2 grid gap-12 max-md:col-span-full">
          {faqCategories.map((category) => {
            const categorySlug = slugify(category.name);

            return (
              <div key={category.name} id={categorySlug} className="scroll-mt-24">
                <h2 className="section-title">{category.name}</h2>

                <div className="mt-4 border-t border-ink/25">
                  {category.items.map((item, itemIndex) => {
                    const key = `${categorySlug}-${itemIndex}`;
                    const open = openKey === key;

                    return (
                      <div
                        key={key}
                        className={`border-b border-ink/25 transition-colors ${
                          open ? "border-l-[3px] border-l-brass bg-[var(--panel-surface)]" : "border-l-[3px] border-l-transparent"
                        }`}
                      >
                        <h3>
                          <button
                            type="button"
                            id={`${key}-trigger`}
                            aria-expanded={open}
                            aria-controls={`${key}-panel`}
                            onClick={() => setOpenKey(open ? null : key)}
                            className="inner-focus flex min-h-16 w-full items-center justify-between gap-5 px-4 py-4 text-left text-[1.0625rem] font-semibold leading-[1.4] text-ink transition-colors hover:text-[var(--brass-ink)] sm:px-5"
                          >
                            <span>{item.question}</span>
                            <span
                              aria-hidden="true"
                              className={`relative grid h-8 w-8 shrink-0 place-items-center border transition-colors ${
                                open ? "border-ink bg-ink text-ivory" : "border-ink/55 text-ink"
                              }`}
                            >
                              <span className="absolute h-px w-3.5 bg-current" />
                              <span
                                className={`absolute h-3.5 w-px bg-current transition-transform duration-200 ${open ? "scale-y-0" : ""}`}
                              />
                            </span>
                          </button>
                        </h3>

                        <div
                          id={`${key}-panel`}
                          role="region"
                          aria-labelledby={`${key}-trigger`}
                          inert={!open}
                          className="grid transition-[grid-template-rows] duration-300 ease-[var(--ease-ui)]"
                          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                        >
                          <div className="overflow-hidden">
                            <p className="prose-body max-w-[66ch] px-4 pb-5 sm:px-5">{item.answer}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
