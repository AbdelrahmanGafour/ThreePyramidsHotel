import { PageOpening } from "@/shared/components/ui/PageOpening";
import { packages } from "@/features/packages/data/packagesDemoData";

export function PackagesHero() {
  const prices = packages.map((pkg) => pkg.priceFrom).filter((price): price is number => typeof price === "number");
  const lowest = prices.length ? Math.min(...prices) : null;

  return (
    <PageOpening
      eyebrow="Journeys and experiences"
      title="Curated journeys"
      meta={
        <>
          {packages.length} journeys
          {lowest ? <> &middot; from ${lowest} per person</> : null}
        </>
      }
    >
      Each journey combines a stay at the hotel with a planned route of places and experiences. Explore one, or enquire
      and we&apos;ll shape it around your dates.
    </PageOpening>
  );
}
