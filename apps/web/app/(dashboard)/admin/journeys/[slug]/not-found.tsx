import Link from "next/link";

// Route-local, so a missing journey stays inside the admin shell with the
// navigation and the breadcrumb intact, rather than dropping staff onto the
// public 404.
//
// It covers both ways a journey can fail to resolve — a slug the API refused
// as malformed, and a well-formed one nothing matches. The page keeps that
// distinction internally; saying which it was here would tell staff nothing
// they can act on.

export default function JourneyNotFound() {
  return (
    <>
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href="/admin/journeys">
            Back to journeys
          </Link>
        </p>
        <h1 className="adm-page-title">Journey not found</h1>
        <p className="adm-page-lede">No journey in the catalogue matches that address.</p>
      </header>

      <section className="adm-panel" aria-labelledby="journey-missing-title">
        <div className="adm-panel-head">
          <h2 id="journey-missing-title" className="adm-panel-title">
            What to check
          </h2>
          <p className="adm-panel-note">
            Journey addresses are lowercase and hyphenated, like{" "}
            <code>nile-dinner-cruise</code>. Find the journey in the catalogue rather than typing
            its address.
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
