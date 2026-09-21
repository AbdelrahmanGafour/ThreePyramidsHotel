"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Sign out — the smallest possible island of interactivity in the admin chrome.
//
// The session cookie is HttpOnly, so the browser cannot end its own session: it
// asks this app's proxy, which asks Express, which deletes the session row and
// clears the cookie. Nothing here reads document.cookie, names the cookie, or
// keeps any client-side notion of being signed in — so there is no local state
// to "clear" and no way for this button to fake a sign-out that did not happen.

const LOGOUT_ENDPOINT = "/api/admin/auth/logout";

export function AdminLogoutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Activating the button disables it, which drops focus to the document. Once
  // the failure has re-enabled it, focus belongs back on the control the
  // administrator was using — an effect, because the button is still disabled
  // at the moment the state is set.
  useEffect(() => {
    if (failed) {
      buttonRef.current?.focus();
    }
  }, [failed]);

  const signOut = async () => {
    // Belt and braces with `disabled`: one click, one request.
    if (signingOut) {
      return;
    }

    setFailed(false);
    setSigningOut(true);

    let response: Response;

    try {
      response = await fetch(LOGOUT_ENDPOINT, {
        method: "POST",
        // No body: Express reads the session from the cookie the browser sends
        // with this same-origin request.
        credentials: "same-origin",
      });
    } catch {
      // The request never arrived, so the session is very probably still live.
      setFailed(true);
      setSigningOut(false);
      return;
    }

    // 204 is the API's only success: the session row is gone and the clearing
    // Set-Cookie has been relayed. Anything else is treated as a failure, since
    // sending someone to the login page while their session survives is worse
    // than telling them to try again.
    if (response.status === 204) {
      router.replace("/admin/login");
      router.refresh();
      // Stays disabled through the navigation.
      return;
    }

    setFailed(true);
    setSigningOut(false);
  };

  return (
    <div className="adm-signout">
      <button
        ref={buttonRef}
        type="button"
        className="adm-signout-btn"
        onClick={signOut}
        disabled={signingOut}
        aria-busy={signingOut}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>

      {failed ? (
        <p className="adm-signout-error" role="alert">
          Could not sign out. Please try again.
        </p>
      ) : null}
    </div>
  );
}
