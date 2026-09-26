import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// What the rate editor puts on the page, and what it refuses to put there.
//
// The component reaches a Server Action, which imports `next/headers` and
// cannot be loaded here — the same pincer the other admin write screens hit.
// So the row inventory, the pre-fill wiring and the gating are asserted
// against the source that decides the markup; the parsing that consumes the
// submission, the overlap rule and the empty-set policy are tested directly
// in lib/packages.test.ts, and the request body in server/adminPackagesApi.test.ts.

const source = readFileSync(
  "features/admin/components/AdminPackageRatesForm.tsx",
  "utf8",
);

const page = readFileSync(
  "app/(dashboard)/admin/journeys/[slug]/variants/[key]/rates/page.tsx",
  "utf8",
);

const action = readFileSync(
  "features/admin/server/adminPackageActions.ts",
  "utf8",
);

describe("admin rate tier editor", () => {
  it("gives every row the three fields the API accepts, and no fourth", () => {
    for (const name of ["minPartySize", "maxPartySize", "adultUnitRate"]) {
      assert.ok(source.includes(`name="${name}"`), `a row should have a ${name} box`);
    }

    // Identically named on every row, which is what makes them arrive as the
    // parallel arrays the parser reads.
    assert.equal(source.match(/name="minPartySize"/g)?.length, 1, "one row component, not many");
  });

  it("preloads the tiers the variant already has", () => {
    assert.ok(
      source.includes("tier={variant.rates[index]}"),
      "each slot should be filled from the tier at that position",
    );
    assert.ok(source.includes("defaultValue={tier ? tier.minPartySize : \"\"}"));
    assert.ok(source.includes("defaultValue={tier ? tier.adultUnitRate : \"\"}"));
  });

  it("renders an open-ended largest party as a blank box, never as a number", () => {
    assert.ok(
      source.includes('defaultValue={tier && tier.maxPartySize !== null ? tier.maxPartySize : ""}'),
      "a null ceiling should leave the box empty",
    );
    assert.ok(
      source.includes('placeholder="No limit"'),
      "and should say what an empty box means",
    );
  });

  it("offers blank slots to add tiers, and removal by clearing a row", () => {
    assert.ok(
      source.includes("variant.rates.length + SPARE_RATE_ROWS"),
      "the existing tiers plus spare slots",
    );
    assert.match(source, /Clear a row to remove that tier/);
  });

  it("keeps the rate a text box, so nothing rounds the amount", () => {
    const rateBox = source.slice(source.indexOf('name="adultUnitRate"'));
    const declaredType = rateBox.slice(0, rateBox.indexOf("/>")).match(/type="(\w+)"/)?.[1];

    assert.equal(declaredType, "text", "a number input would invite rounding");
    assert.ok(rateBox.includes('inputMode="decimal"'), "while still offering a decimal keypad");
  });

  it("offers no currency control, because the currency is the server's", () => {
    assert.ok(!/name="currency"/.test(source));
    assert.match(source, /currency is fixed and is not editable/);
  });

  it("binds the journey, the variant and the policy server-side", () => {
    assert.ok(
      source.includes(
        "replacePackageRatesAction.bind(null, journey.slug, variant.key, allowEmpty)",
      ),
      "none of the three should be submittable from the browser",
    );
    assert.ok(!/name="slug"/.test(source) && !/name="key"/.test(source));
  });

  it("states the empty-set rule only where it applies", () => {
    assert.ok(
      source.includes("const allowEmpty = packageAllowsEmptyRates(journey);"),
      "the rule is the tested helper's, not this component's",
    );
    assert.ok(
      source.includes("{!allowEmpty ? (") && source.includes("{RATES_REQUIRED_MESSAGE}"),
      "an active, deterministically-priced journey should be told it must keep a tier",
    );
  });

  it("never offers to deactivate the journey on the administrator's behalf", () => {
    for (const forbidden of [/deactivateAction/i, /updatePackageStatusAction/, /name="isActive"/]) {
      assert.ok(!forbidden.test(source), `${forbidden} has no place on this screen`);
    }
  });

  it("warns about ownership only when the journey is still the brochure's", () => {
    assert.ok(
      source.includes("packageRatesOwnershipWarning(journey.managementSource)"),
      "the decision is the tested helper's",
    );
    assert.ok(
      source.includes("{ownershipWarning ? (") && source.includes("{ownershipWarning}"),
      "and the panel is rendered only when it returns one",
    );
  });
});

describe("admin rate tier page", () => {
  it("offers no editor when the current tiers could not be read", () => {
    const unavailable = page.slice(
      page.indexOf('if (result.state === "unavailable")'),
      page.indexOf("const journey = result.data;"),
    );

    assert.ok(
      !unavailable.includes("<AdminPackageRatesForm"),
      "saving would replace a set nobody has seen",
    );
    assert.match(unavailable, /These rate tiers are unavailable/);
  });

  it("sends an unknown journey or variant to the not-found page", () => {
    assert.match(page, /if \(!variant\) \{\s*notFound\(\);/);
    assert.match(page, /result\.state === "invalid" \|\| result\.state === "not-found"/);
  });

  it("explains each refusal without claiming the save happened", () => {
    for (const notice of ["invalid", "overlapping", "rates-required"]) {
      assert.ok(page.includes(`${notice.includes("-") ? `"${notice}"` : notice}:`),
        `${notice} should have a notice`);
    }
    assert.match(page, /Nothing was saved/);
  });

  it("reports an unknown outcome as unknown, and re-reads rather than retrying", () => {
    assert.match(page, /could not be confirmed/);
    assert.match(page, /have been re-read/);

    // Scoped to this action: the file holds several, each with its own branch.
    const ratesAction = action.slice(action.indexOf("export async function replacePackageRatesAction"));
    const unavailableBranch = ratesAction.slice(ratesAction.indexOf('case "unavailable":'));

    assert.match(unavailableBranch, /uncertain/);
    assert.ok(
      !/replaceAdminPackageRates/.test(unavailableBranch),
      "an uncertain save is never repeated on its own",
    );
  });
});
