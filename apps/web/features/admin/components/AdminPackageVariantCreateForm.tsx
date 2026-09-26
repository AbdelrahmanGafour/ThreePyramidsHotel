import {
  packageVariantCreateOwnershipWarning,
  packageVariantDefaultNote,
} from "../lib/packages";
import { createPackageVariantAction } from "../server/adminPackageActions";
import type { AdminPackageDetail } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";

// The form that adds one variant to a journey.
//
// A server component rendering a plain form. The only client code involved is
// the shared submit button; there is no client state and the browser never
// calls the API.
//
// Only the five fields the create contract accepts have inputs. The default
// flag and the position are stated as facts the server will decide, not
// offered as controls: each decides something a reservation depends on, and
// changing either is its own operation that does not exist yet. Rate tiers
// are not here at all — a new variant arrives unpriced, and pricing it is a
// separate step against its own sub-resource.
//
// The journey's slug is bound server-side, so the submission carries no
// identity beyond the key the administrator typed.
//
// This component is rendered only for an inactive journey. The page decides
// that, because a live journey gets an explanation instead of a form.

export function AdminPackageVariantCreateForm({ journey }: { journey: AdminPackageDetail }) {
  // Bound server-side: the form posts no slug.
  const submit = createPackageVariantAction.bind(null, journey.slug);
  const ownershipWarning = packageVariantCreateOwnershipWarning(journey.managementSource);

  return (
    <div className="adm-detail-grid">
      {ownershipWarning ? (
        <section className="adm-panel" aria-labelledby="variant-new-ownership">
          <PanelHeader id="variant-new-ownership" title="Before you save" />
          <p className="adm-notice" data-tone="warn" role="status">
            {ownershipWarning}
          </p>
        </section>
      ) : null}

      <section className="adm-panel" aria-labelledby="variant-new-context">
        <PanelHeader
          id="variant-new-context"
          title="This journey"
          note="A new variant arrives with no rates. Price it from the journey page once it exists."
        />
        <dl className="adm-facts">
          <div>
            <dt>Journey</dt>
            <dd>{journey.title}</dd>
          </div>
          <div>
            <dt>Existing variants</dt>
            <dd>{journey.variants.length}</dd>
          </div>
        </dl>

        <p className="adm-detail-note">{packageVariantDefaultNote(journey.variants.length)}</p>
      </section>

      <section className="adm-panel" aria-labelledby="variant-new-form">
        <PanelHeader
          id="variant-new-form"
          title="Variant details"
          note="Rates are not set here."
        />

        <form className="adm-form" action={submit}>
          <AdminFormField
            id="variant-new-key"
            label="Key"
            hint="Lower-case letters, numbers and hyphens, like standard-service. This is the variant's permanent identifier within this journey and cannot be changed afterwards."
          >
            <input
              id="variant-new-key"
              name="key"
              type="text"
              className="field-control"
              maxLength={120}
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="variant-new-key-hint"
            />
          </AdminFormField>

          <AdminFormField
            id="variant-new-label"
            label="Label"
            hint="What guests see this variant called, like Standard service."
          >
            <input
              id="variant-new-label"
              name="label"
              type="text"
              className="field-control"
              maxLength={200}
              required
              aria-describedby="variant-new-label-hint"
            />
          </AdminFormField>

          <fieldset className="adm-field">
            <legend className="field-label">Child pricing</legend>

            <label className="adm-checkbox" htmlFor="variant-new-child-enabled">
              <input
                id="variant-new-child-enabled"
                name="childPricingEnabled"
                type="checkbox"
                value="yes"
                aria-describedby="variant-new-child-hint"
              />
              <span>This variant has a child rate</span>
            </label>

            <p className="field-hint" id="variant-new-child-hint">
              Leave this unticked for no child rate at all; the three boxes below are then ignored.
              Ticked, all three are required — a rule cannot be half set.
            </p>

            <AdminFormField
              id="variant-new-child-min"
              label="Youngest age"
              hint="The youngest age the child rate applies to."
            >
              <input
                id="variant-new-child-min"
                name="childMinAge"
                type="number"
                className="field-control"
                min={0}
                step={1}
                inputMode="numeric"
                aria-describedby="variant-new-child-min-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="variant-new-child-max"
              label="Oldest age"
              hint="The oldest age the child rate applies to. It cannot be below the youngest."
            >
              <input
                id="variant-new-child-max"
                name="childMaxAge"
                type="number"
                className="field-control"
                min={0}
                step={1}
                inputMode="numeric"
                aria-describedby="variant-new-child-max-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="variant-new-child-discount"
              label="Discount percent"
              hint="How much less a child pays, as a percentage between 0 and 100 — for example 50 or 33.33."
            >
              {/* Deliberately text, not number: the value is a decimal the
                  hotel records, and a number input would invite the browser
                  and the runtime to round it. */}
              <input
                id="variant-new-child-discount"
                name="childDiscountPercent"
                type="text"
                className="field-control"
                inputMode="decimal"
                maxLength={6}
                aria-describedby="variant-new-child-discount-hint"
              />
            </AdminFormField>
          </fieldset>

          <div className="adm-actions">
            <AdminActionButton tone="confirm" pendingLabel="Adding…">
              Add variant
            </AdminActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}
