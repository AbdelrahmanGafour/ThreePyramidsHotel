import {
  RATES_REQUIRED_MESSAGE,
  SPARE_RATE_ROWS,
  packageAllowsEmptyRates,
  packageRatesOwnershipWarning,
} from "../lib/packages";
import { replacePackageRatesAction } from "../server/adminPackageActions";
import type { AdminPackageDetail, AdminPackageVariant } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { PanelHeader } from "./PanelHeader";

// The editor that replaces one variant's whole rate set.
//
// A server component rendering a plain form, pre-filled from the tiers the
// page already read. The only client code involved is the shared submit
// button; there is no client state and the browser never calls the API.
//
// Rows are a fixed number of slots rather than anything dynamic: the existing
// tiers, plus a few blanks to add to. Clearing a row's boxes removes that
// tier, and filling a blank one adds it — which is the whole of "add and
// remove" without a line of client JavaScript. The three fields are named
// identically on every row, so they arrive as parallel arrays.
//
// The request replaces the set outright, so what the form shows is what the
// variant will have. Nothing here sends a currency: USD is the server's.

function RateRow({
  index,
  tier,
}: {
  index: number;
  tier?: { minPartySize: number; maxPartySize: number | null; adultUnitRate: string };
}) {
  const rowId = `rate-row-${index}`;

  return (
    <tr>
      <td>
        <label className="adm-sr-only" htmlFor={`${rowId}-min`}>
          Smallest party for row {index + 1}
        </label>
        <input
          id={`${rowId}-min`}
          name="minPartySize"
          type="number"
          className="field-control"
          min={1}
          step={1}
          inputMode="numeric"
          defaultValue={tier ? tier.minPartySize : ""}
        />
      </td>
      <td>
        <label className="adm-sr-only" htmlFor={`${rowId}-max`}>
          Largest party for row {index + 1}, blank for no limit
        </label>
        <input
          id={`${rowId}-max`}
          name="maxPartySize"
          type="number"
          className="field-control"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder="No limit"
          defaultValue={tier && tier.maxPartySize !== null ? tier.maxPartySize : ""}
        />
      </td>
      <td>
        <label className="adm-sr-only" htmlFor={`${rowId}-rate`}>
          Rate per adult for row {index + 1}
        </label>
        {/* Deliberately text, not number: the rate is a decimal the hotel
            recorded, and a number input would invite the browser and the
            runtime to round it. */}
        <input
          id={`${rowId}-rate`}
          name="adultUnitRate"
          type="text"
          className="field-control"
          inputMode="decimal"
          maxLength={13}
          placeholder="0.00"
          defaultValue={tier ? tier.adultUnitRate : ""}
        />
      </td>
    </tr>
  );
}

export function AdminPackageRatesForm({
  journey,
  variant,
}: {
  journey: AdminPackageDetail;
  variant: AdminPackageVariant;
}) {
  const allowEmpty = packageAllowsEmptyRates(journey);

  // Bound server-side: the form posts no slug, no key, and no policy flag.
  const submit = replacePackageRatesAction.bind(null, journey.slug, variant.key, allowEmpty);
  const ownershipWarning = packageRatesOwnershipWarning(journey.managementSource);

  const rows = variant.rates.length + SPARE_RATE_ROWS;

  return (
    <div className="adm-detail-grid">
      {ownershipWarning ? (
        <section className="adm-panel" aria-labelledby="rates-ownership">
          <PanelHeader id="rates-ownership" title="Before you save" />
          <p className="adm-notice" data-tone="warn" role="status">
            {ownershipWarning}
          </p>
        </section>
      ) : null}

      <section className="adm-panel" aria-labelledby="rates-context">
        <PanelHeader
          id="rates-context"
          title="This variant"
          note="Rates are per adult, in USD. The currency is fixed and is not editable."
        />
        <dl className="adm-facts">
          <div>
            <dt>Journey</dt>
            <dd>{journey.title}</dd>
          </div>
          <div>
            <dt>Variant</dt>
            <dd>{variant.label}</dd>
          </div>
          <div>
            <dt>Key</dt>
            <dd>{variant.key}</dd>
          </div>
        </dl>

        {!allowEmpty ? (
          <p className="adm-detail-note">
            <span className="adm-detail-empty">{RATES_REQUIRED_MESSAGE}</span>
          </p>
        ) : null}
      </section>

      <section className="adm-panel" aria-labelledby="rates-form">
        <PanelHeader
          id="rates-form"
          title="Rate tiers"
          note="Saving replaces every tier with exactly what is below. Clear a row to remove that tier; fill a blank row to add one. Leave the largest party empty for an open-ended tier."
        />

        <form className="adm-form" action={submit}>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Smallest party</th>
                  <th scope="col">Largest party</th>
                  <th scope="col">Rate per adult (USD)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_unused, index) => (
                  <RateRow key={index} index={index} tier={variant.rates[index]} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-actions">
            <AdminActionButton tone="confirm" pendingLabel="Saving…">
              Save rate tiers
            </AdminActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}
