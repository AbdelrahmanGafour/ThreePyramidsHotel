import { hasChildPricing, packageVariantOwnershipWarning } from "../lib/packages";
import { editPackageVariantAction } from "../server/adminPackageActions";
import type { AdminPackageDetail, AdminPackageVariant } from "../types";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import { PanelHeader } from "./PanelHeader";

// The form that edits one variant's metadata.
//
// A server component rendering a plain form, pre-filled from the variant the
// page already read. The only client code involved is the shared submit
// button; there is no client state and the browser never calls the API.
//
// Only the four fields the edit contract accepts have inputs. The key, the
// default flag, the order and the rate tiers appear as read-only context:
// each decides something a reservation depends on, and each is its own later
// step. The journey's slug and this variant's key are bound server-side, so
// the submission carries no identity at all.

export function AdminPackageVariantEditForm({
  journey,
  variant,
}: {
  journey: AdminPackageDetail;
  variant: AdminPackageVariant;
}) {
  // Bound server-side: the form posts no slug and no key.
  const submit = editPackageVariantAction.bind(null, journey.slug, variant.key);
  const ownershipWarning = packageVariantOwnershipWarning(journey.managementSource);
  const childPricing = hasChildPricing(variant);

  return (
    <div className="adm-detail-grid">
      {ownershipWarning ? (
        <section className="adm-panel" aria-labelledby="variant-edit-ownership">
          <PanelHeader id="variant-edit-ownership" title="Before you save" />
          <p className="adm-notice" data-tone="warn" role="status">
            {ownershipWarning}
          </p>
        </section>
      ) : null}

      <section className="adm-panel" aria-labelledby="variant-edit-identity">
        <PanelHeader
          id="variant-edit-identity"
          title="This variant"
          note="The key, the default flag, the order and the rates are managed elsewhere."
        />
        <dl className="adm-facts">
          <div>
            <dt>Journey</dt>
            <dd>{journey.title}</dd>
          </div>
          <div>
            <dt>Key</dt>
            <dd>{variant.key}</dd>
          </div>
          <div>
            <dt>Default</dt>
            <dd>{variant.isDefault ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>{variant.sortOrder}</dd>
          </div>
          <div>
            <dt>Rate tiers</dt>
            <dd>{variant.rates.length === 0 ? "None" : `${variant.rates.length}`}</dd>
          </div>
        </dl>
      </section>

      <section className="adm-panel" aria-labelledby="variant-edit-form">
        <PanelHeader
          id="variant-edit-form"
          title="Variant details"
          note="Rates are not changed here."
        />

        <form className="adm-form" action={submit}>
          <AdminFormField
            id="variant-edit-label"
            label="Label"
            hint="What guests see this variant called, like Standard service."
          >
            <input
              id="variant-edit-label"
              name="label"
              type="text"
              className="field-control"
              maxLength={200}
              required
              defaultValue={variant.label}
              aria-describedby="variant-edit-label-hint"
            />
          </AdminFormField>

          <fieldset className="adm-field">
            <legend className="field-label">Child pricing</legend>

            <label className="adm-checkbox" htmlFor="variant-edit-child-enabled">
              <input
                id="variant-edit-child-enabled"
                name="childPricingEnabled"
                type="checkbox"
                value="yes"
                defaultChecked={childPricing}
                aria-describedby="variant-edit-child-hint"
              />
              <span>This variant has a child rate</span>
            </label>

            <p className="field-hint" id="variant-edit-child-hint">
              Untick this to remove the child rate entirely; the three boxes below are then
              ignored. Ticked, all three are required — a rule cannot be half set.
            </p>

            <AdminFormField
              id="variant-edit-child-min"
              label="Youngest age"
              hint="The youngest age the child rate applies to."
            >
              <input
                id="variant-edit-child-min"
                name="childMinAge"
                type="number"
                className="field-control"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={variant.childMinAge ?? ""}
                aria-describedby="variant-edit-child-min-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="variant-edit-child-max"
              label="Oldest age"
              hint="The oldest age the child rate applies to. It cannot be below the youngest."
            >
              <input
                id="variant-edit-child-max"
                name="childMaxAge"
                type="number"
                className="field-control"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={variant.childMaxAge ?? ""}
                aria-describedby="variant-edit-child-max-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="variant-edit-child-discount"
              label="Discount percent"
              hint="How much less a child pays, as a percentage between 0 and 100 — for example 50 or 33.33."
            >
              {/* Deliberately text, not number: the value is a decimal the
                  hotel recorded, and a number input would invite the browser
                  and the runtime to round it. */}
              <input
                id="variant-edit-child-discount"
                name="childDiscountPercent"
                type="text"
                className="field-control"
                inputMode="decimal"
                maxLength={6}
                defaultValue={variant.childDiscountPercent ?? ""}
                aria-describedby="variant-edit-child-discount-hint"
              />
            </AdminFormField>
          </fieldset>

          <div className="adm-actions">
            <AdminActionButton tone="confirm" pendingLabel="Saving…">
              Save variant
            </AdminActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}
