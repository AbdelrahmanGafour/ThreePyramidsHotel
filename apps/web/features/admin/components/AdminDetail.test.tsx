import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DetailChip,
  DetailEmpty,
  DetailFacts,
  DetailMasthead,
  DetailPage,
  DetailSection,
  DetailSectionLink,
} from "./AdminDetail";

// The contract four detail screens depend on. Two things matter most here:
// that a section is a panel with a heading row, and that a metadata table
// always renders both halves of the desktop/mobile pair.

describe("DetailPage", () => {
  it("is the wrapper every detail-page style is scoped to", () => {
    const html = renderToStaticMarkup(
      <DetailPage>
        <p>anything</p>
      </DetailPage>,
    );

    assert.match(html, /^<div class="adm-detail">/);
  });
});

describe("DetailMasthead", () => {
  const render = (props: Parameters<typeof DetailMasthead>[0]) =>
    renderToStaticMarkup(<DetailMasthead {...props} />);

  it("is a panel carrying the page's own heading", () => {
    const html = render({ title: "Nile Dinner Cruise" });

    assert.match(html, /class="adm-panel adm-detail-ident"/);
    assert.match(html, /<h1 class="adm-ident-title">Nile Dinner Cruise<\/h1>/);
  });

  it("puts a drawn separator between identifiers, never before the first", () => {
    const html = render({ title: "T016", meta: [<span key="a">A</span>, <span key="b">B</span>] });

    assert.equal((html.match(/class="adm-ident-sep"/g) ?? []).length, 1);
    // Typed punctuation would reach a screen reader as a word.
    assert.match(html, /class="adm-ident-sep" aria-hidden="true"/);
  });

  it("omits the metadata line rather than rendering an empty one", () => {
    assert.ok(!render({ title: "T016" }).includes("adm-ident-meta"));
    assert.ok(!render({ title: "T016", meta: [] }).includes("adm-ident-meta"));
  });

  it("omits the badge and action groups when there are none", () => {
    const html = render({ title: "T016" });

    assert.ok(!html.includes("adm-ident-badges"));
    assert.ok(!html.includes("adm-ident-actions"));
  });

  it("keeps actions out of the identity block, so they align as a group", () => {
    const html = render({
      title: "T016",
      badges: <span>Active</span>,
      actions: <a href="/edit">Edit</a>,
    });

    assert.ok(
      html.indexOf("adm-ident-badges") < html.indexOf("adm-ident-actions"),
      "facts first, then the controls",
    );
    assert.ok(
      !html.slice(html.indexOf("adm-ident-main"), html.indexOf("adm-ident-actions")).includes("/edit"),
      "the action is a sibling of the identity block, not inside it",
    );
  });
});

describe("DetailSection", () => {
  it("is a panel with a heading row the section is labelled by", () => {
    const html = renderToStaticMarkup(
      <DetailSection id="x-guest" title="Guest">
        <p>body</p>
      </DetailSection>,
    );

    assert.match(html, /class="adm-panel adm-sheet" aria-labelledby="x-guest"/);
    assert.match(html, /<h2 id="x-guest" class="adm-sheet-title">Guest<\/h2>/);
    assert.ok(html.indexOf("adm-sheet-head") < html.indexOf("body"), "heading over the body");
  });

  it("renders a preamble between the heading and the body, not after it", () => {
    const html = renderToStaticMarkup(
      <DetailSection id="x" title="Pricing" note="As stored.">
        <p>body</p>
      </DetailSection>,
    );

    assert.ok(html.indexOf("As stored.") < html.indexOf("body"));
    assert.match(html, /class="adm-sheet-note">As stored\./);
  });

  it("omits the preamble and the action slot when unused", () => {
    const html = renderToStaticMarkup(
      <DetailSection id="x" title="Guest">
        <p>body</p>
      </DetailSection>,
    );

    assert.ok(!html.includes("adm-sheet-note"));
    assert.ok(!html.includes("adm-sheet-action"));
  });

  it("puts a section's one management action in its heading row", () => {
    const html = renderToStaticMarkup(
      <DetailSection
        id="x"
        title="Itinerary"
        action={<DetailSectionLink href="/manage">Manage itinerary</DetailSectionLink>}
      >
        <p>body</p>
      </DetailSection>,
    );

    const head = html.slice(0, html.indexOf("body"));
    assert.ok(head.includes('href="/manage"'), "found where the section is named");
    assert.match(head, /class="adm-sheet-link"/);
  });
});

describe("DetailFacts", () => {
  const rows = [
    { label: "Reference", value: "TPP-1" },
    { label: "Status", value: <span>Pending</span> },
  ];

  it("renders the desktop table and the mobile list together", () => {
    // `.adm-table-wrap` is hidden below 720px and `.adm-list` above it, so a
    // section that renders one without the other vanishes at one width while
    // staying in the DOM. That failure has happened here once already.
    const html = renderToStaticMarkup(<DetailFacts rows={rows} />);

    assert.equal((html.match(/class="adm-table-wrap"/g) ?? []).length, 1);
    assert.equal((html.match(/class="adm-list"/g) ?? []).length, 1);
  });

  it("carries the same rows in both halves", () => {
    const html = renderToStaticMarkup(<DetailFacts rows={rows} />);
    const table = html.slice(0, html.indexOf('<ul class="adm-list">'));
    const list = html.slice(html.indexOf('<ul class="adm-list">'));

    for (const half of [table, list]) {
      assert.ok(half.includes("Reference") && half.includes("TPP-1"));
      assert.ok(half.includes("Status") && half.includes("Pending"));
    }
  });

  it("labels each desktop row with a row header, not a data cell", () => {
    const html = renderToStaticMarkup(<DetailFacts rows={rows} />);

    assert.match(html, /<th scope="row" class="adm-cell-label">Reference<\/th>/);
  });

  it("renders an empty set as an empty table rather than throwing", () => {
    const html = renderToStaticMarkup(<DetailFacts rows={[]} />);

    assert.match(html, /class="adm-table-wrap"/);
    assert.match(html, /class="adm-list"/);
  });
});

describe("DetailEmpty and DetailChip", () => {
  it("says an empty section is empty, inside the panel body", () => {
    const html = renderToStaticMarkup(<DetailEmpty>Nothing recorded.</DetailEmpty>);

    assert.equal(html, '<p class="adm-empty-row">Nothing recorded.</p>');
  });

  it("sets a chip off from running text without claiming a status", () => {
    const html = renderToStaticMarkup(<DetailChip>USD</DetailChip>);

    assert.equal(html, '<span class="adm-chip">USD</span>');
    assert.ok(!html.includes("adm-status"), "a chip is not a status badge");
  });
});
