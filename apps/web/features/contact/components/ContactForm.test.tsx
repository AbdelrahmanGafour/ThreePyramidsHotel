import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactForm } from "./ContactForm";

// The contact form's initial markup, plus the submission logic it runs.
//
// `renderToStaticMarkup` gives the form as a visitor first meets it, which is
// where the honeypot and the field set can be checked properly. The async
// behaviour — pending, success, failure — cannot be driven this way, because
// no event handler runs in a static render, so those are read from the source
// the way this repo already tests its other interactive client components.
//
// The decisions those handlers delegate to are covered for real in
// `features/contact/lib/contactApi.test.ts`, which is where the judgement
// about what a response means actually lives.

const html = renderToStaticMarkup(<ContactForm />);

const source = readFileSync("features/contact/components/ContactForm.tsx", "utf8");
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("the form a visitor first sees", () => {
  it("shows the inquiry form, not a confirmation", () => {
    assert.match(html, /Send an inquiry/);
    assert.equal(html.includes("Thank you for getting in touch"), false);
  });

  it("offers the six business fields", () => {
    for (const id of [
      "inquiry-firstName",
      "inquiry-lastName",
      "inquiry-email",
      "inquiry-phone",
      "inquiry-inquiryType",
      "inquiry-message",
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
    }
  });

  it("offers all four inquiry types", () => {
    for (const type of ["Room reservation", "Curated journey", "Airport transfer", "General inquiry"]) {
      assert.ok(html.includes(`<option value="${type}">`), `missing ${type}`);
    }
  });

  it("starts with an enabled submit button", () => {
    const button = /<button[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";

    assert.match(button, /Send inquiry/);
    assert.match(button, /aria-busy="false"/, "nothing is pending yet");
    // Checked as an ATTRIBUTE, not as a substring: the class list carries
    // Tailwind's `disabled:` variants, which are styling, not state.
    assert.equal(/<button[^>]*\sdisabled(=|\s|>)/.test(button), false, "and it is not disabled");
  });

  it("renders no internal reference anywhere", () => {
    assert.equal(html.includes("TPC-"), false);
    assert.equal(/reference/i.test(html), false, "a visitor is never shown one");
  });
});

describe("the honeypot", () => {
  it("is present in the form", () => {
    assert.ok(html.includes('name="website"'), "a bot that fills every field will find it");
    assert.ok(html.includes('id="inquiry-website"'));
  });

  it("is hidden from people without being hidden from submitters", () => {
    // `hidden` is deliberately avoided: some automated submitters skip hidden
    // inputs outright, which would defeat the trap. It is positioned
    // off-screen and removed from the accessibility tree instead.
    const field = /<div aria-hidden="true"[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";

    assert.ok(field.includes('name="website"'), "the trap lives inside the hidden wrapper");
    assert.match(field, /left-\[-9999px\]/, "off-screen rather than display:none");
    assert.ok(field.includes('tabIndex="-1"') || field.includes('tabindex="-1"'), "keyboard skips it");
    // Case-insensitive: HTML attribute names are, and React emits this one
    // as it was written rather than lowercasing it.
    assert.match(field, /autocomplete="off"/i, "and so does autofill");
    assert.equal(html.includes('type="hidden"'), false, "not an input a submitter would skip");
  });

  it("is not presented as a normal field", () => {
    // No FormField wrapper, so it carries none of the required marks, hints or
    // error slots the real fields do.
    assert.equal(html.includes("Do not fill this in</label>") && html.includes("field-error"), false);
    assert.equal(/aria-required="true"[^>]*name="website"/.test(html), false);
  });

  it("is never explained to the visitor", () => {
    // Naming the mechanism would tell a person writing a bot exactly what to
    // avoid, and would puzzle everybody else.
    for (const word of ["honeypot", "spam", "bot", "robot"]) {
      assert.equal(html.toLowerCase().includes(word), false, `must not mention ${word}`);
    }
  });

  it("is bound to state so it is always submitted", () => {
    assert.match(code, /value=\{website\}/);
    assert.match(code, /submitContactInquiry\(\{ \.\.\.values, website \}\)/);
  });
});

describe("submitting", () => {
  it("validates before it sends anything", () => {
    const validateAt = code.indexOf("validateContactInquiry(values)");
    const submitAt = code.indexOf("await submitContactInquiry");

    assert.ok(validateAt > 0 && submitAt > 0);
    assert.ok(validateAt < submitAt, "a local failure costs no round trip");
  });

  it("keeps the focus-first-invalid-field behaviour", () => {
    assert.match(code, /const firstInvalid = fieldOrder\.find/);
    assert.match(code, /document\.getElementById\(`inquiry-\$\{firstInvalid\}`\)\?\.focus\(\)/);
    // And returns before submitting.
    const focusAt = code.indexOf("firstInvalid");
    const submitAt = code.indexOf("await submitContactInquiry");
    assert.ok(focusAt < submitAt);
  });

  it("refuses a second submission while one is in flight", () => {
    // Two in-flight submissions would mean two emails about one message.
    assert.match(code, /if \(pending\) return;/);
    const guardAt = code.indexOf("if (pending) return;");
    const submitAt = code.indexOf("await submitContactInquiry");
    assert.ok(guardAt > 0 && guardAt < submitAt, "the guard runs first");
  });

  it("disables the button and says what is happening", () => {
    assert.match(code, /disabled=\{pending\}/);
    assert.match(code, /aria-busy=\{pending\}/);
    assert.match(code, /pending \? "Sending…" : "Send inquiry"/);
  });

  it("shows the confirmation only after the backend accepted it", () => {
    // The whole point of this slice: no success panel on a local pass alone.
    assert.match(code, /if \(result\.outcome === "success"\) \{\s*setSent\(true\);/);
    assert.equal(
      /setSent\(true\)(?![\s\S]{0,40}outcome)/.test(code.replace(/if \(result\.outcome === "success"\) \{\s*setSent\(true\);/, "")),
      false,
      "setSent is reached through the success branch only",
    );
  });

  it("leaves the visitor on the form with their words when it fails", () => {
    // No setValues, no reset: everything they typed is still there to retry.
    const handler = /const handleSubmit[\s\S]*?\n  \};/.exec(code)?.[0] ?? "";

    assert.ok(handler.length > 0, "the handler was found");
    assert.equal(handler.includes("setValues"), false, "entered values are preserved");
    assert.match(handler, /setSubmitError\(CONTACT_SUBMISSION_ERROR_MESSAGE\)/);
    assert.match(handler, /setPending\(false\)/, "and the form becomes usable again");
  });

  it("shows one generic message, never anything the server said", () => {
    assert.match(code, /message=\{[\s\S]*?submitError[\s\S]*?\}/);
    // The result union carries no message to display, so there is nothing
    // technical available to leak even by accident.
    assert.equal(code.includes("result.message"), false);
    assert.equal(code.includes("result.code"), false);
    assert.equal(code.includes("result.status"), false);
  });

  it("clears the error when a fresh inquiry is started", () => {
    const reset = /const sendAnother[\s\S]*?\n  \};/.exec(code)?.[0] ?? "";

    assert.match(reset, /setSubmitError\(null\)/);
    assert.match(reset, /setWebsite\(""\)/);
  });
});

describe("what the form does not do", () => {
  it("never reaches the API address from the browser", () => {
    assert.equal(code.includes("API_BASE_URL"), false);
    assert.equal(code.includes("NEXT_PUBLIC"), false);
    assert.equal(code.includes("http://"), false);
    assert.equal(code.includes("https://"), false);
    // It goes through the feature's client, which goes through the bridge.
    assert.match(code, /from "@\/features\/contact\/lib\/contactApi"/);
  });

  it("carries no demo-only wording any more", () => {
    for (const stale of ["DEMO", "no backend endpoint yet", "no request is sent", "PRESENTATION"]) {
      assert.equal(source.includes(stale), false, `stale comment: ${stale}`);
    }
  });

  it("promises the visitor no email of their own", () => {
    // Hotel-only: there is no autoresponder, so the copy must not imply one.
    const confirmation = /if \(sent\) \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";

    assert.ok(confirmation.length > 0, "the confirmation panel was found");
    assert.equal(/confirmation email|we have emailed|check your inbox/i.test(confirmation), false);
  });
});
