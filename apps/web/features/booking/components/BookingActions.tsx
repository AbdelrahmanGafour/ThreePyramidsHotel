import Link from "next/link";
import type { ReactNode } from "react";

type BookingActionsProps = {
  backHref?: string;
  backLabel?: string;
  continueLabel: string;
  continueType?: "submit" | "button";
  onContinue?: () => void;
  disabled?: boolean;
  /** Plain-language reason shown while the primary action is unavailable. */
  disabledHint?: string;
  /** Pins the action to the bottom of the screen on mobile, where a long step benefits from it. */
  sticky?: boolean;
  /** Shown beside the action on the sticky bar (e.g. the chosen room and total). */
  helper?: ReactNode;
};

// The one back/continue row every booking step uses: one dominant primary
// action, and "Back" as a quiet text link. Sticky mode keeps the primary
// action reachable on mobile without redesigning the step itself.
export function BookingActions({
  backHref,
  backLabel = "Back",
  continueLabel,
  continueType = "button",
  onContinue,
  disabled,
  disabledHint,
  sticky,
  helper,
}: BookingActionsProps) {
  const continueButton = (
    <button
      type={continueType}
      onClick={continueType === "button" ? onContinue : undefined}
      disabled={disabled}
      className="btn btn-primary w-full sm:w-auto sm:min-w-[16rem]"
    >
      {continueLabel}
    </button>
  );

  const backLink = backHref ? (
    <Link href={backHref} className="btn-link">
      <span aria-hidden="true">&larr;</span> {backLabel}
    </Link>
  ) : null;

  const hint =
    disabled && disabledHint ? (
      <p role="status" className="fine-print sm:text-right">
        {disabledHint}
      </p>
    ) : null;

  if (sticky) {
    return (
      <div className="sticky bottom-0 z-30 -mx-[var(--page-x)] mt-8 border-t border-ink/15 bg-ivory px-[var(--page-x)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(30,24,21,0.06)] sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        {helper ? <div className="mb-2 text-[0.9375rem] text-ink/80 sm:hidden">{helper}</div> : null}
        {hint ? <div className="mb-2 sm:mb-3">{hint}</div> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {backLink ?? <span />}
          {continueButton}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {hint ? <div className="mb-3">{hint}</div> : null}
      <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        {backLink ? <div className="flex justify-center sm:justify-start">{backLink}</div> : <span />}
        {continueButton}
      </div>
    </div>
  );
}
