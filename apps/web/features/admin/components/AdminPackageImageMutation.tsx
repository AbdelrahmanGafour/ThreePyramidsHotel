"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

// Shared pending state for a journey's image controls.
//
// `AdminActionButton` knows only about its own form: `useFormStatus` reports
// on the nearest enclosing one, so replacing an image disables the replace
// button and leaves delete and the description save clickable. For four
// controls that all change the same single image, that is not enough — a
// delete sent while a replacement is in flight is a second mutation nobody
// asked to queue.
//
// So the panel wraps its controls in one group, and each submit reports
// whether its own form is running. While any of them is, every other one is
// disabled.
//
// The smallest island that can do this. It holds one string of state, it is
// scoped to the panel rather than the page, and there is no store: outside
// this subtree nothing knows it exists. Above all it moves no request into
// the browser — every control is still a plain `<form action={serverAction}>`
// and the Server Action still owns the API call, the session cookie and the
// outcome. Nothing here fetches, retries, or touches storage.

/**
 * The group's whole state machine, as a function.
 *
 * Pure and exported so the coordination can be proved directly rather than
 * inferred from rendered markup: `useFormStatus` reports nothing on a server
 * render, so a test that only rendered would never see a blocked control.
 *
 * Only the control that claimed the group may release it. Two reports
 * arriving out of order — a finishing one from a control that already lost
 * the claim — therefore cannot unlock the group under the one still running.
 */
export function nextBusy(current: string | null, id: string, pending: boolean): string | null {
  if (pending) {
    return id;
  }

  return current === id ? null : current;
}

/**
 * Whether a control must refuse to start because a sibling is running.
 *
 * Deliberately not "is anything pending": the running control disables
 * itself through its own form status and shows its pending wording, and
 * conflating the two would make every button claim to be doing something.
 */
export function isBlocked(busy: string | null, id: string): boolean {
  return busy !== null && busy !== id;
}

type ImageMutationGroupValue = {
  /** Which control is running, or null. */
  busy: string | null;
  report: (id: string, pending: boolean) => void;
};

/**
 * The default is deliberately inert rather than throwing.
 *
 * A button rendered outside a group still works exactly as
 * `AdminActionButton` does — it disables itself while its own form is in
 * flight — and simply coordinates with nothing. Nothing is silently broken
 * by a missing provider, and no control is ever left permanently disabled
 * by one.
 */
const ImageMutationContext = createContext<ImageMutationGroupValue>({
  busy: null,
  report: () => undefined,
});

/**
 * One group of controls that must not run at the same time.
 *
 * `busy` is set by whichever control started and cleared by that same
 * control when it finishes — never by another, so two reports arriving out
 * of order cannot leave the group stuck. When a Server Action redirects, the
 * page re-renders and this state is either cleared by the finishing report
 * or discarded with the unmounted subtree; either way the next render is the
 * server's, not a remembered one.
 */
export function ImageMutationGroup({ children }: { children: React.ReactNode }) {
  const [busy, setBusy] = useState<string | null>(null);

  const report = useCallback((id: string, pending: boolean) => {
    setBusy((current) => nextBusy(current, id, pending));
  }, []);

  const value = useMemo(() => ({ busy, report }), [busy, report]);

  return <ImageMutationContext.Provider value={value}>{children}</ImageMutationContext.Provider>;
}

/**
 * A submit that disables itself while its own form is in flight, and while
 * any other control in its group is.
 *
 * `id` names the control to the group. It is not user-visible and never
 * reaches a request; it exists so a control can release only the lock it
 * took.
 *
 * `blockedLabel` is deliberately absent: a button disabled because something
 * else is running keeps its own words. Changing the text of three buttons
 * because a fourth was pressed would say something happened to them.
 */
export function ImageMutationButton({
  id,
  tone,
  pendingLabel,
  children,
}: {
  id: string;
  tone: "confirm" | "cancel";
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  const { busy, report } = useContext(ImageMutationContext);

  useEffect(() => {
    report(id, pending);
  }, [id, pending, report]);

  // Blocked by a sibling, not by itself: the two are kept apart so only the
  // running control shows its pending wording.
  const blocked = isBlocked(busy, id);

  return (
    <button
      type="submit"
      className="adm-action-btn"
      data-tone={tone}
      disabled={pending || blocked}
      aria-busy={pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
