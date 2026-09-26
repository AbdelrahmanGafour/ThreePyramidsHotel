import Link from "next/link";

// Route-local, so a missing journey or variant stays inside the admin shell
// rather than dropping staff onto the public 404. It covers all three ways
// this address can fail to resolve — an address that is not one, a journey
// nothing matches, and a journey with no such variant.

export default function VariantEditNotFound() {
  return (
    <>
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href="/admin/journeys">
            Back to journeys
          </Link>
        </p>
        <h1 className="adm-page-title">Variant not found</h1>
        <p className="adm-page-lede">
          No variant at that address, so there is nothing to edit.
        </p>
      </header>

      <section className="adm-panel" aria-labelledby="variant-missing-title">
        <div className="adm-panel-head">
          <h2 id="variant-missing-title" className="adm-panel-title">
            What to check
          </h2>
          <p className="adm-panel-note">
            Open the journey and choose the variant from its own page, rather than typing the
            address.
          </p>
        </div>
        <p className="adm-panel-foot">
          <Link className="adm-topbar-link" href="/admin/journeys">
            Browse all journeys
          </Link>
        </p>
      </section>
    </>
  );
}
