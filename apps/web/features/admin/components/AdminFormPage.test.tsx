import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FormActions,
  FormFields,
  FormMasthead,
  FormPage,
  FormRow,
  FormSection,
  FormStack,
} from "./AdminFormPage";

// The contract the two create screens depend on. The thing that matters most
// is that grouping the fields into panels changed nothing about the form:
// one <form>, wrapping every section, posting to the action it was given.

describe("FormPage", () => {
  it("is the wrapper every create-page style is scoped to", () => {
    const html = renderToStaticMarkup(
      <FormPage>
        <p>anything</p>
      </FormPage>,
    );

    assert.match(html, /^<div class="adm-form-page">/);
  });
});

describe("FormMasthead", () => {
  it("is a panel carrying the page's own heading", () => {
    const html = renderToStaticMarkup(<FormMasthead title="New journey" />);

    assert.match(html, /class="adm-panel adm-form-masthead"/);
    assert.match(html, /<h1 class="adm-ident-title">New journey<\/h1>/);
  });

  it("carries the lede beside the heading, not on the bare page", () => {
    const html = renderToStaticMarkup(
      <FormMasthead title="New journey" lede="It starts as a draft." />,
    );

    assert.match(html, /class="adm-form-lede">It starts as a draft\./);
  });

  it("omits the lede rather than rendering an empty paragraph", () => {
    assert.ok(!renderToStaticMarkup(<FormMasthead title="New journey" />).includes("adm-form-lede"));
  });
});

describe("FormSection", () => {
  it("uses the same panel and heading row the detail pages use", () => {
    const html = renderToStaticMarkup(
      <FormSection id="x-basics" title="Basic information">
        <p>fields</p>
      </FormSection>,
    );

    assert.match(html, /class="adm-panel adm-sheet" aria-labelledby="x-basics"/);
    assert.match(html, /<h2 id="x-basics" class="adm-sheet-title">Basic information<\/h2>/);
  });

  it("renders a section that is only a heading and an explanation", () => {
    // The "what creating this does" panel has no fields in it.
    const html = renderToStaticMarkup(
      <FormSection id="x" title="What this does" note="It creates a draft." />,
    );

    assert.match(html, /class="adm-sheet-note">It creates a draft\./);
  });
});

describe("FormStack", () => {
  const action = async () => {};

  it("is one form, wrapping every section", () => {
    const html = renderToStaticMarkup(
      <FormStack action={action}>
        <FormSection id="a" title="One">
          <FormFields>
            <input name="first" />
          </FormFields>
        </FormSection>
        <FormSection id="b" title="Two">
          <FormFields>
            <input name="second" />
          </FormFields>
        </FormSection>
      </FormStack>,
    );

    assert.equal((html.match(/<form/g) ?? []).length, 1, "grouping must not split the payload");
    assert.ok(html.indexOf('name="first"') > html.indexOf("<form"));
    assert.ok(html.indexOf('name="second"') < html.indexOf("</form>"));
  });

  it("renders each field group in the admin's existing form rhythm", () => {
    const html = renderToStaticMarkup(
      <FormFields>
        <FormRow>
          <input name="a" />
          <input name="b" />
        </FormRow>
      </FormFields>,
    );

    assert.match(html, /class="adm-form"/);
    assert.match(html, /class="adm-field-row"/);
  });
});

describe("FormActions", () => {
  it("puts the submit in a bar of its own at the foot of the form", () => {
    const html = renderToStaticMarkup(
      <FormActions>
        <button>Create journey</button>
      </FormActions>,
    );

    assert.match(html, /^<div class="adm-form-actions">/);
    assert.ok(html.includes("Create journey"));
  });

  it("offers the way out as a link, after the primary action", () => {
    const html = renderToStaticMarkup(
      <FormActions cancelHref="/admin/journeys" cancelLabel="Cancel">
        <button>Create journey</button>
      </FormActions>,
    );

    assert.ok(html.indexOf("Create journey") < html.indexOf("Cancel"), "primary first");
    assert.match(html, /<a class="adm-form-cancel" href="\/admin\/journeys">Cancel<\/a>/);
    // Leaving posts nothing, so it must never be a second submit button.
    assert.equal((html.match(/<button/g) ?? []).length, 1);
  });

  it("omits the link when the page offers no way out of its own", () => {
    const html = renderToStaticMarkup(
      <FormActions>
        <button>Create</button>
      </FormActions>,
    );

    assert.ok(!html.includes("adm-form-cancel"));
  });
});
