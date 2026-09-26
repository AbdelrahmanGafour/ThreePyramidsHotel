import {
  MAX_CONTENT_ENTRIES,
  MAX_CONTENT_ENTRY_LENGTH,
  PACKAGE_CONTENT_LISTS,
  PACKAGE_CONTENT_LIST_LABELS,
  packageContentOwnershipWarning,
  packageContentRowCount,
  type PackageContentList,
} from "../lib/packages";
import { replacePackageContentAction } from "../server/adminPackageActions";
import type { AdminPackageDetail } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { PanelHeader } from "./PanelHeader";

// The editor that replaces a journey's three content lists.
//
// A server component rendering one plain form, pre-filled from the lists the
// page already read. The only client code involved is the shared submit
// button; there is no client state and the browser never calls the API.
//
// Rows are fixed slots rather than anything dynamic: the entries a list
// already has, plus a few blanks to add to, capped so the form cannot offer
// more rows than the API would accept. Clearing a row's box removes that
// entry and filling a blank one adds it — which is the whole of "add and
// remove" without a line of client JavaScript. Every box in a list carries
// the same name, so they arrive as an ordered array.
//
// All three lists are submitted together, because the request replaces the
// whole set. That is also what makes clearing everything expressible: empty
// every box and all three lists arrive empty.
//
// Nothing here is gated on publication. These lists are prose on the detail
// page, and no part of a booking reads them.

function ContentRow({
  list,
  index,
  value,
}: {
  list: PackageContentList;
  index: number;
  value?: string;
}) {
  const id = `content-${list}-${index}`;

  return (
    <li>
      <label className="adm-sr-only" htmlFor={id}>
        {`${PACKAGE_CONTENT_LIST_LABELS[list]} item ${index + 1}`}
      </label>
      <input
        id={id}
        name={list}
        type="text"
        className="field-control"
        maxLength={MAX_CONTENT_ENTRY_LENGTH}
        defaultValue={value ?? ""}
      />
    </li>
  );
}

function ContentList({
  list,
  entries,
}: {
  list: PackageContentList;
  entries: readonly string[];
}) {
  const rows = packageContentRowCount(entries.length);

  return (
    <section className="adm-panel" aria-labelledby={`content-${list}`}>
      <PanelHeader
        id={`content-${list}`}
        title={PACKAGE_CONTENT_LIST_LABELS[list]}
        note="Clear a box to remove that line; fill a blank one to add it. The order here is the order guests read."
      />

      <ul className="adm-form-list">
        {Array.from({ length: rows }, (_unused, index) => (
          <ContentRow key={index} list={list} index={index} value={entries[index]} />
        ))}
      </ul>
    </section>
  );
}

export function AdminPackageContentForm({ journey }: { journey: AdminPackageDetail }) {
  // Bound server-side: the form posts no slug.
  const submit = replacePackageContentAction.bind(null, journey.slug);
  const ownershipWarning = packageContentOwnershipWarning(journey.managementSource);

  return (
    <form className="adm-form" action={submit}>
      <div className="adm-detail-grid">
        {ownershipWarning ? (
          <section className="adm-panel" aria-labelledby="content-ownership">
            <PanelHeader id="content-ownership" title="Before you save" />
            <p className="adm-notice" data-tone="warn" role="status">
              {ownershipWarning}
            </p>
          </section>
        ) : null}

        <section className="adm-panel" aria-labelledby="content-context">
          <PanelHeader
            id="content-context"
            title="This journey"
            note={`Saving replaces all three lists with exactly what is below. Each line may be up to ${MAX_CONTENT_ENTRY_LENGTH} characters, and each list up to ${MAX_CONTENT_ENTRIES} lines.`}
          />
          <dl className="adm-facts">
            <div>
              <dt>Journey</dt>
              <dd>{journey.title}</dd>
            </div>
          </dl>

          <p className="adm-detail-note">
            Leaving every box empty clears that list, which is allowed. Text is stored exactly as
            typed, so a stray space at the start or end is reported rather than removed for you.
          </p>
        </section>

        {PACKAGE_CONTENT_LISTS.map((list) => (
          <ContentList key={list} list={list} entries={journey.content[list]} />
        ))}

        <div className="adm-actions">
          <AdminActionButton tone="confirm" pendingLabel="Saving…">
            Save content
          </AdminActionButton>
        </div>
      </div>
    </form>
  );
}
