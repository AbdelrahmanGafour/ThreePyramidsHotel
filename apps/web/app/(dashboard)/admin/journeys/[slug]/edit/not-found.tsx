import Link from "next/link";

// Route-local, so a missing journey stays inside the admin shell rather than
// dropping staff onto the public 404. It covers both a slug the API refused
// and a well-formed one nothing matches.

export default function JourneyEditNotFound() {
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
          No journey in the catalogue matches that address, so there is nothing to edit.
        </p>
      </header>

      <section className="adm-panel" aria-labelledby="journey-edit-missing-title">
        <div className="adm-panel-head">
          <h2 id="journey-edit-missing-title" className="adm-panel-title">
            What to check
          </h2>
          <p className="adm-panel-note">
            Find the journey in the catalogue and edit it from its own page, rather than typing its
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
