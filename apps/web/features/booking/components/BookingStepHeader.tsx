import type { ReactNode } from "react";

type BookingStepHeaderProps = {
  /** e.g. "Step 2 of 4" — always tells the guest where they are. */
  step: string;
  title: string;
  children?: ReactNode;
};

// The same three lines at the top of every booking screen: where you are,
// what this step is, and the one sentence that says what to do here.
export function BookingStepHeader({ step, title, children }: BookingStepHeaderProps) {
  return (
    <header>
      <p className="eyebrow">{step}</p>
      <h1 className="page-title mt-2 text-[clamp(1.85rem,4.4vw,2.4rem)]!">{title}</h1>
      {children ? <p className="page-lede mt-3">{children}</p> : null}
    </header>
  );
}
