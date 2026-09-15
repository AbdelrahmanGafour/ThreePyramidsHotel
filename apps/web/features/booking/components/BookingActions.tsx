import Link from "next/link";
import type { ReactNode } from "react";

type BookingActionsProps = {
  backHref?: string;
  backLabel?: string;
  continueLabel: string;
  continueType?: "submit" | "button";
  onContinue?: () => void;
  disabled?: boolean;
  /** Pins the action to the bottom of the screen on mobile, where a long step benefits from it. */
  sticky?: boolean;
  /** Shown beside the action on the sticky bar (e.g. a running total). */
  helper?: ReactNode;
};

// The one back/continue row every booking step uses. Sticky mode keeps the
// primary action reachable on mobile without redesigning the step itself.
export function BookingActions({
  backHref,
  backLabel = "Back",
  continueLabel,
  continueType = "button",
  onContinue,
  disabled,
  sticky,
  helper,
}: BookingActionsProps) {
  const continueButton = (
    <button
      type={continueType}
      onClick={continueType === "button" ? onContinue : undefined}
      disabled={disabled}
      className="brass-button min-h-11 w-full disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
    >
      {continueLabel}
    </button>
  );

  if (sticky) {
    return (
      <div className="sticky bottom-0 z-30 mt-8 border-t border-brass/20 bg-ivory/95 px-[var(--page-x)] py-3 backdrop-blur-sm sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          {backHref ? (
            <Link href={backHref} className="text-link hidden text-ink/68 sm:inline-flex">
              &lt;- {backLabel}
            </Link>
          ) : null}
          {helper ? <div className="flex-1 sm:hidden">{helper}</div> : null}
          {continueButton}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
      {backHref ? (
        <Link href={backHref} className="text-link justify-center text-ink/68 sm:justify-start">
          &lt;- {backLabel}
        </Link>
      ) : (
        <span />
      )}
      {continueButton}
    </div>
  );
}
