import type { StatusMeta } from "../lib/status";

/** Text label + shaped mark. Colour reinforces meaning; it never carries it alone. */
export function StatusBadge({ meta }: { meta: StatusMeta }) {
  return (
    <span className="adm-status" data-tone={meta.tone}>
      <span className="adm-status-mark" data-shape={meta.shape} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
