import Link from "next/link";

// Route-local, so a missing journey stays inside the admin shell rather than
// dropping staff onto the public 404. It covers both ways this address can
// fail to resolve — an address that is not one, and a journey nothing matches.

export default function VariantNewNotFound() {
  return (
    <>
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href="/admin/journeys">
            Back to journeys
          </Link>
        </p>
        <h1 className="adm-page-title">Journey not found</h1>
        <p className="adm-page-lede">
          No journey at that address, so there is nothing to add a variant to.
        </p>
      </header>

      <section className="adm-panel" aria-labelledby="variant-new-missing-title">
        <div className="adm-panel-head">
          <h2 id="variant-new-missing-title" className="adm-panel-title">
            What to check
          </h2>
          <p className="adm-panel-note">
            Open the journey from the catalogue and add the variant from its own page, rather than
            typing the address.
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
