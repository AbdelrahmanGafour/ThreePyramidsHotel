// Shown when the API cannot say who is signed in.
//
// Not a sign-in prompt and not an error page: the administrator may well have a
// perfectly good session, so this must not suggest they were signed out or that
// signing in again would help. No dashboard content is rendered behind it, and
// the navigation is left out — nothing here is known to be safe to show.
//
// Built entirely from the existing admin classes; the dashboard is untouched.

export function AdminUnavailable({ reason }: { reason: string }) {
  return (
    <div className="adm">
      <main className="adm-main" tabIndex={-1}>
        <header className="adm-page-head">
          <h1 className="adm-page-title">Administration is unavailable</h1>
          <p className="adm-page-lede">
            The hotel system could not be reached, so this page cannot confirm who is signed in.
            Your session has not been ended — please try again in a moment.
          </p>
        </header>

        <div className="adm-panel">
          <div className="adm-panel-head">
            <p className="adm-panel-title">If this continues</p>
            <p className="adm-panel-note">
              Reload the page. If it still fails, contact the hotel’s system administrator: the
              reservation system itself may be down, not just this screen.
            </p>
          </div>
          <p className="adm-panel-foot">{reason}</p>
        </div>
      </main>
    </div>
  );
}
