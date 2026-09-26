import { CtaBand } from "@/shared/components/ui/CtaBand";

type RoomsReservationBandProps = {
  title: string;
  text: string;
  /** Room detail also shows a sticky mobile booking bar with the same action —
   * hide this band's buttons below `lg` there so the two don't compete. */
  hideActionOnMobile?: boolean;
  href?: string;
  actionLabel?: string;
  /** A specific room's final decision block is deliberately ONE action —
   * the listing's own closing band still offers "Contact the hotel" as a
   * second path for a guest who isn't ready to pick a room yet. */
  hideSecondary?: boolean;
};

// The page's single closing reservation prompt — shared by the listing and
// every room detail page so the two never drift into near-duplicate markup.
export function RoomsReservationBand({
  title,
  text,
  hideActionOnMobile,
  href = "/booking",
  actionLabel = "Check dates and availability",
  hideSecondary,
}: RoomsReservationBandProps) {
  return (
    <CtaBand
      id="reserve"
      title={title}
      text={text}
      primary={{ href, label: actionLabel }}
      secondary={hideSecondary ? undefined : { href: "/contact", label: "Contact the hotel" }}
      hideActionsOnMobile={hideActionOnMobile}
    />
  );
}
