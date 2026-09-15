import Link from "next/link";

type BookingEmptyStateProps = {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

// The graceful landing for a step opened directly without its prerequisite
// state (a fresh tab, an expired session, a shared link) — never a broken
// form or a raw error box.
export function BookingEmptyState({
  title,
  message,
  actionLabel = "Start your reservation",
  actionHref = "/booking",
}: BookingEmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center gap-5 px-[var(--page-x)] py-[clamp(4rem,10vw,6rem)] text-center">
      <span className="h-px w-10 bg-aged-gold/45" aria-hidden="true" />
      <div>
        <h1 className="display text-[clamp(1.5rem,4vw,1.85rem)] leading-[1.15] text-ink">{title}</h1>
        <p className="mt-3 text-[0.92rem] leading-[1.7] text-ink/64">{message}</p>
      </div>
      <Link href={actionHref} className="brass-button min-h-11">
        {actionLabel}
      </Link>
    </div>
  );
}
