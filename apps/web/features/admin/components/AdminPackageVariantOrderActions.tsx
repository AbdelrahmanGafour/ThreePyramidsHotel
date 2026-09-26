import {
  MOVE_DOWN_LABEL,
  MOVE_UP_LABEL,
  packageVariantMoves,
} from "../lib/packages";
import { reorderPackageVariantsAction } from "../server/adminPackageActions";
import { AdminActionButton } from "./AdminActionButton";

// Moving one variant up or down the running order.
//
// A server component with plain forms, so the buttons work before any
// JavaScript arrives. Deliberately not drag-and-drop: two buttons need no
// client state, no pointer handling and no accessibility story of their own.
//
// Each button carries the COMPLETE order that pressing it would produce,
// bound on the server at render time. The form posts nothing — not the key,
// not the direction — so there is no field a crafted submission could
// substitute, and the API never has to interpret a move against an order this
// page did not see.
//
// A variant at the top has no Move up and one at the bottom has no Move down,
// because the tested helper returns null for both; a journey with fewer than
// two variants gets neither, since there is nowhere for anything to go.
//
// Reordering is offered whether or not the journey is on sale: no part of a
// booking reads a variant's position.
//
// Both buttons take the shared affirmative tone. Neither is destructive, and
// widening the shared button's tones for this one screen is not this slice's
// to do.

export function AdminPackageVariantOrderActions({
  slug,
  orderedKeys,
  index,
}: {
  slug: string;
  orderedKeys: readonly string[];
  index: number;
}) {
  const moves = packageVariantMoves(orderedKeys, index);

  if (!moves.up && !moves.down) {
    return null;
  }

  return (
    <>
      {moves.up ? (
        <form action={reorderPackageVariantsAction.bind(null, slug, moves.up)}>
          <AdminActionButton tone="confirm" pendingLabel="Moving…">
            {MOVE_UP_LABEL}
          </AdminActionButton>
        </form>
      ) : null}

      {moves.down ? (
        <form action={reorderPackageVariantsAction.bind(null, slug, moves.down)}>
          <AdminActionButton tone="confirm" pendingLabel="Moving…">
            {MOVE_DOWN_LABEL}
          </AdminActionButton>
        </form>
      ) : null}
    </>
  );
}
