import {
  DEFAULT_BLOCKS_DELETE_NOTE,
  DELETE_VARIANT_LABEL,
  packageVariantDeleteConfirmation,
  packageVariantDeleteState,
} from "../lib/packages";
import { deletePackageVariantAction } from "../server/adminPackageActions";
import { AdminActionButton } from "./AdminActionButton";

// Removing one variant from a journey.
//
// Destructive, so it takes two deliberate steps: the button that actually
// deletes is behind a disclosure, and opening it shows what is about to go,
// named by label AND key — a journey can carry two variants that read alike,
// and the key is the part that is unique.
//
// The disclosure is a plain <details>, not a modal. It needs no client state,
// no focus trap and no JavaScript, so the whole control works before
// hydration exactly as the other admin actions do. There is no dialog
// framework here and this slice does not add one.
//
// Which of the three states this variant is in comes from lib/packages, which
// is pure and tested. What this component never does is guess at bookings:
// whether a variant has ever been sold is the backend's to answer, and a page
// old enough to be showing a button is old enough to be wrong about it.

export function AdminPackageVariantDeleteAction({
  slug,
  journey,
  variant,
}: {
  slug: string;
  journey: { isActive: boolean; variants: readonly unknown[] };
  variant: { key: string; label: string; isDefault: boolean };
}) {
  const state = packageVariantDeleteState(journey, variant);

  // A live journey gets nothing at all: the backend refuses the removal, and
  // a control that could only fail is worse than none.
  if (state === "hidden") {
    return null;
  }

  if (state === "blocked-default") {
    return (
      <p className="adm-sub">
        <span className="adm-detail-empty">{DEFAULT_BLOCKS_DELETE_NOTE}</span>
      </p>
    );
  }

  // Bound server-side: the form posts no slug, no key and no body.
  const submit = deletePackageVariantAction.bind(null, slug, variant.key);

  return (
    <details className="adm-confirm">
      <summary className="adm-ref-link">{DELETE_VARIANT_LABEL}</summary>

      <p className="adm-sub">{packageVariantDeleteConfirmation(variant)}</p>

      <form action={submit}>
        <AdminActionButton tone="cancel" pendingLabel="Deleting…">
          {`Delete ${variant.label}`}
        </AdminActionButton>
      </form>
    </details>
  );
}
