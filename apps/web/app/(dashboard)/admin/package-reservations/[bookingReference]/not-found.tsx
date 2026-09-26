import Link from "next/link";

// Route-local, so a missing package reservation stays inside the admin shell
// with the navigation and the breadcrumb intact, rather than dropping staff
// onto the public 404.
//
// It covers both ways a reservation can fail to resolve — a reference the API
// refused as malformed, and a well-formed one nobody booked. The page keeps
// that distinction internally; saying which it was here would only invite
// guessing at references, and tells staff nothing they can act on.

export default function PackageReservationNotFound() {
  return (
    <>
      <header className="adm-page-head">
        <p className="adm-detail-back">
          <Link className="adm-topbar-link" href="/admin/package-reservations">
            Back to package reservations
          </Link>
        </p>
        <h1 className="adm-page-title">Package reservation not found</h1>
        <p className="adm-page-lede">No package reservation matches that booking reference.</p>
      </header>

      <section className="adm-panel" aria-labelledby="package-reservation-missing-title">
        <div className="adm-panel-head">
          <h2 id="package-reservation-missing-title" className="adm-panel-title">
            What to check
          </h2>
          <p className="adm-panel-note">
            References are case-sensitive and look like <code>TPP-A2B3C4D5E6F7</code>. Check the
            reference against the guest’s confirmation, or find the request in the list.
          </p>
        </div>
        <p className="adm-panel-foot">
          <Link className="adm-topbar-link" href="/admin/package-reservations">
            Browse all package reservations
          </Link>
        </p>
      </section>
    </>
  );
}
