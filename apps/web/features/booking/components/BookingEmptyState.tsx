import Link from "next/link";

type BookingEmptyStateProps = {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

// The graceful landing for a step opened directly without its prerequisite
// state (a fresh tab, an expired session, a shared link) — never a broken
// form or a raw error box. Says what's missing and gives one obvious way on.
export function BookingEmptyState({
  title,
  message,
  actionLabel = "Start your reservation",
  actionHref = "/booking",
}: BookingEmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 px-[var(--page-x)] py-[clamp(3.5rem,9vw,5.5rem)] text-center">
      <h1 className="section-title">{title}</h1>
      <p className="prose-body">{message}</p>
      <Link href={actionHref} className="btn btn-primary mt-2 w-full sm:w-auto">
        {actionLabel}
      </Link>
    </div>
  );
}
