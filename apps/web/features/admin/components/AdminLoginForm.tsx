"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// The interactive half of the sign-in screen.
//
// It posts to this app's own proxy route, never to the API directly, so the
// API's address stays on the server and the session cookie is first-party.
// The cookie is HttpOnly: the browser stores and sends it on its own, and this
// component never reads it, names it, or keeps anything about the sign-in.
// No token, no email, no password is written to storage of any kind.

const LOGIN_ENDPOINT = "/api/admin/auth/login";

/** Kept apart on purpose: a refusal and an outage must not read alike. */
type LoginAlert = {
  tone: "rejected" | "unavailable";
  message: string;
};

type FieldErrors = {
  email?: string;
  password?: string;
};

const REJECTED: LoginAlert = {
  tone: "rejected",
  // Deliberately says nothing about whether the account exists.
  message: "Invalid email or password.",
};

const MALFORMED: LoginAlert = {
  tone: "rejected",
  message: "Please check your email and password, then try again.",
};

const UNAVAILABLE: LoginAlert = {
  tone: "unavailable",
  message: "The hotel system is temporarily unavailable. Please try again.",
};

function AlertIcon({ tone }: { tone: LoginAlert["tone"] }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {tone === "rejected" ? (
        <>
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 6.25v4.5M10 13.5h.01" />
        </>
      ) : (
        <>
          <path d="M10 2.75 17.75 16.5H2.25z" strokeLinejoin="round" />
          <path d="M10 7.75v3.5M10 13.75h.01" />
        </>
      )}
    </svg>
  );
}

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<LoginAlert | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Belt and braces with the disabled button: a second submit must never
    // start a second sign-in.
    if (submitting) {
      return;
    }

    // Only presence is checked here. The API owns what a valid credential is,
    // and the admin:create password policy is deliberately not applied: an
    // existing account's password must be accepted exactly as it was set.
    const trimmedEmail = email.trim();
    const errors: FieldErrors = {};

    if (!trimmedEmail) {
      errors.email = "Enter your email address.";
    }
    if (!password) {
      errors.password = "Enter your password.";
    }

    setFieldErrors(errors);

    if (errors.email || errors.password) {
      setAlert(null);
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setAlert(null);
    setSubmitting(true);

    let response: Response;

    try {
      response = await fetch(LOGIN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same origin, so the proxy's Set-Cookie is stored automatically.
        credentials: "same-origin",
        // The password goes across exactly as typed: never trimmed, never
        // normalised, never logged.
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
    } catch {
      // The request never arrived, so nothing was decided about the
      // credentials. Reported as an outage, never as a refusal.
      setAlert(UNAVAILABLE);
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      // Nothing in the response is inspected: the session lives in the
      // HttpOnly cookie, and the server decides what /admin shows.
      router.replace("/admin");
      router.refresh();
      // `submitting` stays true so the form cannot be posted again while the
      // navigation is in flight.
      return;
    }

    // The status alone decides the message; the body is never surfaced, so no
    // backend code, field name or internal detail reaches the screen.
    if (response.status === 401) {
      setAlert(REJECTED);
    } else if (response.status === 400) {
      setAlert(MALFORMED);
    } else {
      setAlert(UNAVAILABLE);
    }

    setSubmitting(false);
    // Back to the password field, which keeps its value: the alert announces
    // itself, and focus is where a retry starts. Only the button is ever
    // disabled — a disabled input cannot take focus, which would strand a
    // keyboard user at the top of the document instead.
    passwordRef.current?.focus();
  };

  return (
    <form className="adml-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      {alert ? (
        <p className="adml-alert" data-tone={alert.tone} role="alert">
          <AlertIcon tone={alert.tone} />
          <span>{alert.message}</span>
        </p>
      ) : null}

      <div className="adml-field">
        <label className="field-label" htmlFor="admin-login-email">
          Email address
        </label>
        <input
          ref={emailRef}
          id="admin-login-email"
          name="email"
          type="email"
          className="field-control"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "admin-login-email-error" : undefined}
        />
        {fieldErrors.email ? (
          <span className="field-error" id="admin-login-email-error">
            <span aria-hidden="true">✕</span>
            {fieldErrors.email}
          </span>
        ) : null}
      </div>

      <div className="adml-field">
        <label className="field-label" htmlFor="admin-login-password">
          Password
        </label>
        <input
          ref={passwordRef}
          id="admin-login-password"
          name="password"
          type="password"
          className="field-control"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? "admin-login-password-error" : undefined}
        />
        {fieldErrors.password ? (
          <span className="field-error" id="admin-login-password-error">
            <span aria-hidden="true">✕</span>
            {fieldErrors.password}
          </span>
        ) : null}
      </div>

      <button type="submit" className="btn btn-primary adml-submit" disabled={submitting}>
        {submitting ? (
          <>
            <span className="adml-spinner" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
