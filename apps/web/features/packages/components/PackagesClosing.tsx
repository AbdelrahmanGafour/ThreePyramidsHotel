import { CtaBand } from "@/shared/components/ui/CtaBand";

type PackagesClosingProps = {
  title: string;
  text: string;
  href?: string;
  actionLabel?: string;
};

// The one closing prompt for the journeys pages — shared by the listing and
// every journey detail page so the two never drift apart.
export function PackagesClosing({
  title,
  text,
  href = "/contact",
  actionLabel = "Contact the hotel",
}: PackagesClosingProps) {
  return <CtaBand title={title} text={text} primary={{ href, label: actionLabel }} />;
}
