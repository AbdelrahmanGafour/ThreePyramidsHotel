import { packageDefaultVariantAction } from "../lib/packages";
import { makePackageVariantDefaultAction } from "../server/adminPackageActions";
import { AdminActionButton } from "./AdminActionButton";

// Promoting one variant to the one its journey leads with.
//
// A server component with one plain form, so the button works before any
// JavaScript arrives. Both the journey and the variant are bound on the
// server, so the form posts nothing at all — there is no field a crafted
// submission could substitute.
//
// Exactly one control is ever offered, and often none: the variant that
// already leads has nothing to ask for, and a live journey may not be
// rearranged at all. Which case this is comes from lib/packages, which is
// pure and tested. There is deliberately no control that clears the default.
//
// The button is a hint, not a rule. The state it was rendered from may
// already be out of date, and the backend decides what actually happens.

export function AdminPackageDefaultVariantAction({
  slug,
  journey,
  variant,
}: {
  slug: string;
  journey: { isActive: boolean };
  variant: { key: string; isDefault: boolean };
}) {
  const action = packageDefaultVariantAction(journey, variant);

  if (!action) {
    return null;
  }

  // Bound server-side: the form posts no slug and no key.
  const submit = makePackageVariantDefaultAction.bind(null, slug, variant.key);

  return (
    <form action={submit}>
      <AdminActionButton tone={action.tone} pendingLabel={action.pendingLabel}>
        {action.label}
      </AdminActionButton>
    </form>
  );
}
