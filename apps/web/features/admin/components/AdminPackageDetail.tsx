import Link from "next/link";
import {
  NONE_RECORDED,
  NOT_SET,
  packageAllowsVariantCreate,
  packageChildPricingLabel,
  packageContentHref,
  packageDefaultVariantNote,
  packageDefaultVariantOwnershipWarning,
  packageEditHref,
  packageItineraryHref,
  packageRatesHref,
  packageVariantDeleteOwnershipWarning,
  packageVariantEditHref,
  packageVariantNewHref,
  packageVariantOrderNote,
  packageVariantOrderOwnershipWarning,
  packageVariantsLabel,
  packageVariantsRateSummary,
} from "../lib/packages";
import { adminPackageManagementSource, adminPackageStatus } from "../lib/status";
import type {
  AdminPackageDetail as Journey,
  AdminPackageItinerarySection,
  AdminPackageVariant,
} from "../types";
import {
  DetailChip,
  DetailEmpty,
  DetailFacts,
  DetailMasthead,
  DetailSection,
  DetailSectionLink,
} from "./AdminDetail";
import type { DetailFact } from "./AdminDetail";
import { StatusBadge } from "./StatusBadge";

// One journey, read-only, as a back-office screen: a masthead panel, then
// one panel per thing worth scanning, each holding a single table.
//
// Panels rather than bare sections. An earlier pass put the tables straight
// on the workspace ground with a small heading over each; the order was
// right but nothing enclosed it, so the page read as one long sheet. The
// surface used here is `adm-panel`, the same one every other admin screen
// uses, so this page is bounded the way the rest of the admin is.
//
// Every table is rendered twice, because that is what this admin's CSS
// expects. `.adm-table-wrap` is hidden below 720px and `.adm-list` is hidden
// above it, so a section that renders only one of the two disappears at one
// width or the other. The pair is written out in full each time — desktop
// table, mobile rows — and neither class is ever used on its own.
//
// Every figure shown here is a stored value. Nothing is derived: a party's
// price is settled when a reservation is taken, and working one out on a
// catalogue screen would invent a second opinion about it.

/** A muted dash, for a cell that has nothing in it. */
const EMPTY_CELL = "—";

/** A day's title, which may have no day number and no heading. */
function itineraryDayLabel(section: AdminPackageItinerarySection): string {
  return section.dayNumber === null ? EMPTY_CELL : `Day ${section.dayNumber}`;
}

function ItineraryTable({ sections }: { sections: readonly AdminPackageItinerarySection[] }) {
  if (sections.length === 0) {
    return <DetailEmpty>No itinerary recorded.</DetailEmpty>;
  }

  return (
    <>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact">
          <thead>
            <tr>
              <th scope="col" className="adm-col-narrow">
                Day
              </th>
              <th scope="col" className="adm-col-medium">
                Heading
              </th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {/* Rendered in the order the API returned, never re-sorted. */}
            {sections.map((section, index) => (
              <tr key={`${index}-${section.body}`}>
                <td className="adm-cell-muted">{itineraryDayLabel(section)}</td>
                <td>{section.heading ?? EMPTY_CELL}</td>
                <td>{section.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {sections.map((section, index) => (
          <li key={`${index}-${section.body}`}>
            <span className="adm-strong">
              {[
                section.dayNumber === null ? null : `Day ${section.dayNumber}`,
                section.heading,
              ]
                .filter(Boolean)
                .join(" · ") || "Throughout"}
            </span>
            <span className="adm-sub">{section.body}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** One content column's lines, or the shared empty wording when it has none. */
function ContentLines({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return <span className="adm-cell-muted">{NONE_RECORDED}</span>;
  }

  return (
    <ul className="adm-cell-lines">
      {items.map((text, index) => (
        <li key={`${index}-${text}`}>{text}</li>
      ))}
    </ul>
  );
}

const CONTENT_COLUMNS = [
  { key: "included", heading: "Included" },
  { key: "excluded", heading: "Not included" },
  { key: "notes", heading: "Notes" },
] as const;

/**
 * The three content lists side by side on desktop, stacked on mobile.
 *
 * Three columns of one table rather than three sections: they are read
 * together, and separating them left most of the page empty whenever a
 * journey had only a line or two in each.
 */
function ContentTable({ content }: { content: Journey["content"] }) {
  return (
    <>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact">
          <thead>
            <tr>
              {CONTENT_COLUMNS.map((column) => (
                <th key={column.key} scope="col">
                  {column.heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {CONTENT_COLUMNS.map((column) => (
                <td key={column.key} className="adm-cell-top">
                  <ContentLines items={content[column.key]} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {CONTENT_COLUMNS.map((column) => (
          <li key={column.key}>
            <span className="adm-sub">{column.heading}</span>
            <ContentLines items={content[column.key]} />
          </li>
        ))}
      </ul>
    </>
  );
}

/** What a variant's rates amount to, without listing every tier. */
function RateCell({ variant }: { variant: AdminPackageVariant }) {
  if (variant.rates.length === 0) {
    // A chip, not loose red words: this is a state the variant is in, and
    // it should read as a label on the row rather than as an error the
    // table just suffered.
    return (
      <span className="adm-cell-alert">
        <span className="adm-cell-alert-mark" aria-hidden="true" />
        No rates — cannot be booked
      </span>
    );
  }

  return <span>{packageVariantsRateSummary(variant)}</span>;
}

function DefaultCell({ isDefault }: { isDefault: boolean }) {
  if (!isDefault) {
    return <span className="adm-cell-muted">{EMPTY_CELL}</span>;
  }

  return (
    <span className="adm-status" data-tone="lapis">
      <span className="adm-status-mark" data-shape="filled" aria-hidden="true" />
      Default
    </span>
  );
}

/**
 * The links every variant has, plus whatever the page composed for it.
 *
 * `action` carries whatever row controls the page composed for this
 * variant — Server Actions, which this view cannot load itself.
 */
function VariantActions({
  slug,
  variant,
  action,
}: {
  slug: string;
  variant: AdminPackageVariant;
  action?: React.ReactNode;
}) {
  return (
    // Two ranks, not one wrapping run. The links a reader reaches for every
    // day sit on the first line; the positional and destructive controls the
    // page composed sit under them, so neither kind gets lost in the other.
    <div className="adm-row-actions">
      <div className="adm-row-links">
        {/* "Edit variant", not "Edit": the row carries several verbs, and a
            bare one does not say which thing it acts on. */}
        <Link className="adm-row-action" href={packageVariantEditHref(slug, variant.key)}>
          Edit variant
        </Link>
        <Link className="adm-row-action" href={packageRatesHref(slug, variant.key)}>
          Manage rates
        </Link>
      </div>
      {action ? <div className="adm-row-extra">{action}</div> : null}
    </div>
  );
}

function VariantsTable({
  slug,
  variants,
  variantActions,
}: {
  slug: string;
  variants: readonly AdminPackageVariant[];
  variantActions?: ReadonlyMap<string, React.ReactNode>;
}) {
  if (variants.length === 0) {
    return <DetailEmpty>No variants recorded.</DetailEmpty>;
  }

  return (
    <>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact">
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col" className="adm-col-narrow">
                Default
              </th>
              <th scope="col" className="adm-col-medium">
                Child pricing
              </th>
              <th scope="col" className="adm-col-medium">
                Rates
              </th>
              <th scope="col" className="adm-col-actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {/* The API's order, which is the order guests see. */}
            {variants.map((variant) => (
              <tr key={variant.key}>
                <td>
                  <span className="adm-strong">{variant.label}</span>
                  <span className="adm-cell-sub adm-ref">{variant.key}</span>
                </td>
                <td>
                  <DefaultCell isDefault={variant.isDefault} />
                </td>
                <td className="adm-cell-muted">{packageChildPricingLabel(variant)}</td>
                <td>
                  <RateCell variant={variant} />
                </td>
                <td>
                  <VariantActions
                    slug={slug}
                    variant={variant}
                    action={variantActions?.get(variant.key)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {variants.map((variant) => (
          <li key={variant.key}>
            <div className="adm-list-top">
              <span className="adm-strong">{variant.label}</span>
              <DefaultCell isDefault={variant.isDefault} />
            </div>
            <span className="adm-sub adm-ref">{variant.key}</span>
            <span className="adm-sub">{packageChildPricingLabel(variant)}</span>
            <span className="adm-sub">
              <RateCell variant={variant} />
            </span>
            <VariantActions
              slug={slug}
              variant={variant}
              action={variantActions?.get(variant.key)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * `actions` is passed in rather than rendered here.
 *
 * The availability control reaches a Server Action, which imports
 * `next/headers` and can only be loaded under the react-server condition —
 * while the submit button inside it is a Client Component that cannot.
 * Composing it at the page keeps this view free of that pincer, so it stays
 * renderable on its own.
 *
 * `variantActions` is the same arrangement per variant, keyed by variant
 * key. A Map rather than an object so a key can never collide with something
 * inherited from a prototype.
 */
export function AdminPackageDetailView({
  journey,
  actions,
  imagePanel,
  variantActions,
}: {
  journey: Journey;
  actions?: React.ReactNode;
  /**
   * The journey's image section, composed at the page for the same reason
   * `actions` is: it binds Server Actions this view cannot load.
   */
  imagePanel?: React.ReactNode;
  variantActions?: ReadonlyMap<string, React.ReactNode>;
}) {
  const pricing = journey.requiresPriceConfirmation
    ? "Quoted on request"
    : "Priced from the rate tiers";

  // Three separate rules about taking ownership of a brochure journey, each
  // returning null unless its own change is available. Collected here so the
  // markup below is one loop rather than three near-identical blocks.
  const ownershipWarnings = [
    packageDefaultVariantOwnershipWarning(journey),
    packageVariantOrderOwnershipWarning(journey),
    packageVariantDeleteOwnershipWarning(journey),
  ].filter((warning): warning is string => warning !== null);

  const details: DetailFact[] = [
    { label: "Code", value: <span className="adm-ref">{journey.code}</span> },
    { label: "Slug", value: <span className="adm-ref">{journey.slug}</span> },
    { label: "Duration", value: journey.durationLabel ?? NOT_SET },
    { label: "Schedule", value: journey.scheduleLabel ?? NOT_SET },
    {
      label: "Operating days",
      value:
        journey.operatingDays === null || journey.operatingDays.length === 0
          ? NOT_SET
          : journey.operatingDays.join(", "),
    },
    { label: "Pricing", value: pricing },
    {
      label: "Management source",
      value: <StatusBadge meta={adminPackageManagementSource[journey.managementSource]} />,
    },
  ];

  return (
    <>
      {/* The journey's name, its two identifiers, what state it is in, and
          the two things done to the journey as a whole. */}
      <DetailMasthead
        title={journey.title}
        meta={[
          <span className="adm-ref" key="code">
            {journey.code}
          </span>,
          <span className="adm-ref" key="slug">
            {journey.slug}
          </span>,
        ]}
        badges={
          <>
            <StatusBadge meta={adminPackageStatus[journey.isActive ? "active" : "inactive"]} />
            <StatusBadge meta={adminPackageManagementSource[journey.managementSource]} />
            <DetailChip>{pricing}</DetailChip>
          </>
        }
        actions={
          <>
            <Link className="adm-ident-action" href={packageEditHref(journey.slug)}>
              Edit journey
            </Link>
            {packageAllowsVariantCreate(journey) ? (
              <Link className="adm-ident-action" href={packageVariantNewHref(journey.slug)}>
                Add variant
              </Link>
            ) : null}
          </>
        }
      />

      {/* Availability is its own panel. It arrives already panelled, and
          putting a panel inside the masthead's action row was what made the
          top of this page look assembled by accident. */}
      {actions}

      {/* The picture, high on the page: it is the first thing an
          administrator checks about a journey they can already see. */}
      {imagePanel}

      <DetailSection id="journey-detail-details" title="Details">
        <DetailFacts rows={details} />
      </DetailSection>

      <DetailSection id="journey-detail-wording" title="Wording">
        <DetailFacts
          rows={[
            { label: "Summary", value: journey.summary ?? NOT_SET },
            { label: "Description", value: journey.description ?? NOT_SET },
          ]}
        />
      </DetailSection>

      <DetailSection
        id="journey-detail-itinerary"
        title="Itinerary"
        action={
          <DetailSectionLink href={packageItineraryHref(journey.slug)}>Manage itinerary</DetailSectionLink>
        }
      >
        <ItineraryTable sections={journey.itinerary} />
      </DetailSection>

      <DetailSection
        id="journey-detail-content"
        title="Content"
        action={<DetailSectionLink href={packageContentHref(journey.slug)}>Manage content</DetailSectionLink>}
      >
        <ContentTable content={journey.content} />
      </DetailSection>

      <DetailSection
        id="journey-detail-variants"
        title={packageVariantsLabel(journey.variantCount)}
        action={
          packageAllowsVariantCreate(journey) ? (
            <DetailSectionLink href={packageVariantNewHref(journey.slug)}>Add variant</DetailSectionLink>
          ) : (
            <span className="adm-sub">Deactivate this journey to add a variant.</span>
          )
        }
      >
        {/* What the two positional rules mean, said once above the table
            rather than repeated per row. */}
        <p className="adm-sheet-note">
          {packageDefaultVariantNote(journey)} {packageVariantOrderNote(journey.variants.length)}
        </p>

        {/* Each warning appears only where the change it describes is
            actually on offer, so none of them warns about something no
            control can do. Three of them can apply at once, and as three
            boxes they filled the panel before the table began — so they
            share one, each keeping its own wording. */}
        {ownershipWarnings.length > 0 ? (
          <div className="adm-notice" data-tone="warn" role="status">
            {ownershipWarnings.length === 1 ? (
              ownershipWarnings[0]
            ) : (
              <ul className="adm-notice-list">
                {ownershipWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <VariantsTable
          slug={journey.slug}
          variants={journey.variants}
          variantActions={variantActions}
        />
      </DetailSection>
    </>
  );
}
