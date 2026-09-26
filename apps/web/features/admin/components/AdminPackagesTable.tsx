import Link from "next/link";
import { NOT_SET, packageDetailHref, packageVariantsLabel } from "../lib/packages";
import { adminPackageManagementSource, adminPackageStatus } from "../lib/status";
import type { AdminPackageList, AdminPackageListItem } from "../types";
import { StatusBadge } from "./StatusBadge";

// The journey catalogue: a desktop table and a mobile card list of the same
// rows, following the pattern the other admin lists already use.
//
// A server component with no interactivity of its own. There is no pager yet —
// the API returns the whole catalogue.
//
// The labels and the detail href come from lib/packages, shared with the
// detail view, so the same journey can never be described one way here and
// another way on the page this links to.

function StatusBadges({ offering }: { offering: AdminPackageListItem }) {
  return (
    <>
      <StatusBadge meta={adminPackageStatus[offering.isActive ? "active" : "inactive"]} />
      <StatusBadge meta={adminPackageManagementSource[offering.managementSource]} />
      {/* Only ever shown when true: an absent badge says the journey is
          priced outright, which is the ordinary case. */}
      {offering.requiresPriceConfirmation ? (
        <span className="adm-status" data-tone="terracotta">
          <span className="adm-status-mark" data-shape="ring" aria-hidden="true" />
          Price on request
        </span>
      ) : null}
    </>
  );
}

export function AdminPackagesTable({ data }: { data: AdminPackageList }) {
  const { packages } = data;

  if (packages.length === 0) {
    return (
      <section className="adm-panel" aria-labelledby="journeys-empty-title">
        <div className="adm-panel-head">
          <h2 id="journeys-empty-title" className="adm-panel-title">
            No journeys yet
          </h2>
          <p className="adm-panel-note">
            The brochure catalogue has not been loaded, and no journey has been created here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="adm-panel" aria-labelledby="journeys-title">
      <div className="adm-panel-head">
        <h2 id="journeys-title" className="adm-panel-title">
          All journeys
        </h2>
        <p className="adm-panel-note">
          In the order guests see them. Brochure-managed journeys are rewritten by the catalogue
          seed; journeys created here are not.
        </p>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Journey</th>
              <th scope="col">When</th>
              <th scope="col">Variants</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((offering) => (
              <tr key={offering.code}>
                <th scope="row" className="adm-cell-primary">
                  {/* The title is the way in: one link per row, no click
                      handler, and the whole row stays selectable text. */}
                  <Link className="adm-strong adm-ref-link" href={packageDetailHref(offering.slug)}>
                    {offering.title}
                  </Link>
                  <span className="adm-sub adm-ref">{offering.code}</span>
                  {offering.summary ? <span className="adm-sub">{offering.summary}</span> : null}
                </th>
                <td>
                  <span className="adm-strong">{offering.durationLabel ?? NOT_SET}</span>
                  <span className="adm-sub">{offering.scheduleLabel ?? NOT_SET}</span>
                </td>
                <td>
                  <span className="adm-strong">{packageVariantsLabel(offering.variantCount)}</span>
                  {offering.defaultVariantLabel ? (
                    <span className="adm-sub">Default: {offering.defaultVariantLabel}</span>
                  ) : null}
                </td>
                <td>
                  <StatusBadges offering={offering} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {packages.map((offering) => (
          <li key={offering.code}>
            <div className="adm-list-top">
              <Link className="adm-strong adm-ref-link" href={packageDetailHref(offering.slug)}>
                {offering.title}
              </Link>
              <StatusBadge meta={adminPackageStatus[offering.isActive ? "active" : "inactive"]} />
            </div>
            <p className="adm-sub adm-ref">{offering.code}</p>
            {offering.summary ? <p className="adm-sub">{offering.summary}</p> : null}
            <p className="adm-sub">
              {offering.durationLabel ?? NOT_SET} · {offering.scheduleLabel ?? NOT_SET}
            </p>
            <p className="adm-sub">
              {packageVariantsLabel(offering.variantCount)}
              {offering.defaultVariantLabel ? ` · Default: ${offering.defaultVariantLabel}` : ""}
            </p>
            <p>
              <StatusBadge meta={adminPackageManagementSource[offering.managementSource]} />
              {offering.requiresPriceConfirmation ? (
                <span className="adm-status" data-tone="terracotta">
                  <span className="adm-status-mark" data-shape="ring" aria-hidden="true" />
                  Price on request
                </span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
