import Link from "next/link";
import type React from "react";

// The shared shape of an admin detail page.
//
// Four screens read one record in depth — a journey, a room type, a journey
// reservation and a room reservation. They were each assembled separately and
// looked it: one used bare sections on the workspace ground, two used fact
// lists in panels, and their headings, spacing and empty states all differed.
// The pieces here are what they now have in common.
//
// A detail page is a vertical stack of panels:
//
//   <DetailPage>
//     <DetailMasthead …/>   what this record is, and what can be done to it
//     <DetailSection …/>    one panel per thing worth reading
//     …
//   </DetailPage>
//
// Presentation only. Nothing here fetches, decides or formats: every value
// arrives already rendered by the page that owns the domain. That also keeps
// this module loadable under both test conditions — it imports no Server
// Action and no client hook, so a page can compose its actions elsewhere and
// pass them in as nodes.
//
// List pages, dashboard widgets and the form screens deliberately do not use
// any of this. The classes below are styled under `.adm-detail`, so nothing
// outside a detail page can pick them up by accident.

/** The page-level stack. Everything on a detail page sits inside one. */
export function DetailPage({ children }: { children: React.ReactNode }) {
  return <div className="adm-detail">{children}</div>;
}

/**
 * The first panel: what this record is called, how it is identified, what
 * state it is in, and the actions that apply to the whole of it.
 *
 * It carries the page's `<h1>`, so the name sits inside the first panel
 * rather than floating above it on the workspace ground. A page that renders
 * a masthead must not also render a heading in its page header.
 *
 * `meta` is the short identifiers — a code, a slug, a date — shown on one
 * quiet line and separated by a drawn dot rather than a typed one, so no
 * punctuation reaches a screen reader as a word.
 */
export function DetailMasthead({
  title,
  meta,
  badges,
  actions,
}: {
  title: string;
  meta?: readonly React.ReactNode[];
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const facts = (meta ?? []).filter((entry) => entry !== null && entry !== undefined);

  return (
    <header className="adm-panel adm-detail-ident">
      <div className="adm-ident-main">
        <h1 className="adm-ident-title">{title}</h1>

        {facts.length > 0 ? (
          <p className="adm-ident-meta">
            {facts.map((entry, index) => (
              // The index is the position in a list the caller wrote out in
              // full; there is no stable id to key on and no reordering.
              <span className="adm-ident-fact" key={index}>
                {index > 0 ? <span className="adm-ident-sep" aria-hidden="true" /> : null}
                {entry}
              </span>
            ))}
          </p>
        ) : null}

        {badges ? <p className="adm-ident-badges">{badges}</p> : null}
      </div>

      {actions ? <div className="adm-ident-actions">{actions}</div> : null}
    </header>
  );
}

/**
 * One section of a detail page: a heading row, an optional preamble, and a
 * body — usually a table.
 *
 * The action sits in the heading row rather than at the foot of the panel, so
 * a reader's eye finds "Itinerary … Manage itinerary" together instead of
 * hunting for a link after the content.
 */
export function DetailSection({
  id,
  title,
  action,
  note,
  children,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="adm-panel adm-sheet" aria-labelledby={id}>
      <div className="adm-sheet-head">
        <h2 id={id} className="adm-sheet-title">
          {title}
        </h2>
        {action ? <div className="adm-sheet-action">{action}</div> : null}
      </div>
      {note ? <p className="adm-sheet-note">{note}</p> : null}
      {children}
    </section>
  );
}

/** A management link in a section heading, styled as an action. */
export function DetailSectionLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="adm-sheet-link" href={href}>
      {children}
    </Link>
  );
}

/**
 * A section with nothing in it.
 *
 * Said in the panel body rather than left blank, so an empty section is never
 * mistaken for one that failed to load.
 */
export function DetailEmpty({ children }: { children: React.ReactNode }) {
  return <p className="adm-empty-row">{children}</p>;
}

/** One labelled fact in a metadata table. */
export type DetailFact = { label: string; value: React.ReactNode };

/**
 * Label-and-value metadata, as a two-column table on desktop and a labelled
 * stack on mobile — the same rows either way.
 *
 * Both halves are always rendered. `.adm-table-wrap` is hidden below 720px
 * and `.adm-list` is hidden above it, so a section that renders only one of
 * the two disappears at one width or the other; that failure is invisible in
 * the DOM, which is how it survived once already.
 */
export function DetailFacts({ rows }: { rows: readonly DetailFact[] }) {
  return (
    <>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="adm-cell-label">
                  {row.label}
                </th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="adm-sub">{row.label}</span>
            <span>{row.value}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A fact set off from running text, at badge weight but without a badge's
 * status meaning — a currency, a pricing mode, a count.
 */
export function DetailChip({ children }: { children: React.ReactNode }) {
  return <span className="adm-chip">{children}</span>;
}

/**
 * The controls that belong to the record as a whole, grouped.
 *
 * Its own panel, not a row of buttons after the last section: on the
 * reservation screens this is the only thing on the page that changes
 * anything, and it has to be findable without dominating what it acts on.
 */
export function DetailActionsSection({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <DetailSection id={id} title={title} note={note}>
      <div className="adm-actions">{children}</div>
    </DetailSection>
  );
}
