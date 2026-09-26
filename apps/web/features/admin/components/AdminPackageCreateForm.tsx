import { PACKAGES_PATH, PACKAGE_WEEKDAYS } from "../lib/packages";
import { createPackageAction } from "../server/adminPackageActions";
import { AdminActionButton } from "./AdminActionButton";
import { AdminFormField } from "./AdminFormField";
import {
  FormActions,
  FormFields,
  FormMasthead,
  FormPage,
  FormRow,
  FormSection,
  FormStack,
} from "./AdminFormPage";

// The form that creates a journey.
//
// A server component rendering a plain form. The only client code involved is
// the shared submit button, which disables itself while its own form is in
// flight; there is no client state, no optimistic creation, and the browser
// never sends a request to the API itself. Submitting posts to the Server
// Action, which owns the refusal, the classification, the revalidation and
// the redirect — none of that is repeated here.
//
// Only the ten fields the create contract accepts have inputs. There is no
// hidden field anywhere in this form: whether guests can see the journey, and
// who manages it, are the server's own, and the action does not read them
// even if a crafted submission adds them.
//
// The fields are grouped into panels rather than run together in one list,
// but they are all inside one `<form>`: the payload, the names, the
// validation attributes and the order of submission are unchanged.

const WEEKDAY_LABELS: Record<(typeof PACKAGE_WEEKDAYS)[number], string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function AdminPackageCreateForm() {
  return (
    <FormPage>
      <FormMasthead
        title="New journey"
        lede="Add a journey of the hotel’s own. It starts as a draft, and you decide when guests can see it."
      />

      <FormSection
        id="journey-new-boundary"
        title="What creating a journey does"
        note="The journey is created as a draft: it is not shown on the website and guests cannot enquire about it. It is created here rather than taken from the brochure, so the catalogue seed will leave it alone and your changes will keep. Nothing is priced yet — variants and rates are added afterwards — and once the journey is ready, you activate it explicitly from its own page."
      />

      <FormStack action={createPackageAction}>
        <FormSection
          id="journey-new-basics"
          title="Basic information"
          note="The code and the address cannot be changed after the journey is created."
        >
          <FormFields>
            <AdminFormField
              id="journey-new-code"
              label="Code"
              hint="The hotel's own reference for this journey, like ADMIN-001. It must not be one of the brochure codes (T001–T025, P01–P17). Typed exactly as submitted — leading or trailing spaces are refused rather than removed."
            >
              <input
                id="journey-new-code"
                name="code"
                type="text"
                className="field-control"
                maxLength={120}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="journey-new-code-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="journey-new-slug"
              label="Address"
              hint="Lower-case letters, numbers and hyphens, like desert-night-drive. This becomes the journey's permanent address on the website and cannot be changed afterwards."
            >
              <input
                id="journey-new-slug"
                name="slug"
                type="text"
                className="field-control"
                maxLength={120}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="journey-new-slug-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="journey-new-title"
              label="Title"
              hint="What guests will see this journey called."
            >
              <input
                id="journey-new-title"
                name="title"
                type="text"
                className="field-control"
                maxLength={200}
                required
                aria-describedby="journey-new-title-hint"
              />
            </AdminFormField>

            <div className="adm-field-short">
              <AdminFormField
                id="journey-new-sort-order"
                label="Position"
                hint="Where the journey sits in the catalogue order. A whole number, lowest first. Leave it at 0 if the order does not matter yet."
              >
                <input
                  id="journey-new-sort-order"
                  name="sortOrder"
                  type="number"
                  className="field-control"
                  min={0}
                  step={1}
                  defaultValue={0}
                  inputMode="numeric"
                  aria-describedby="journey-new-sort-order-hint"
                />
              </AdminFormField>
            </div>
          </FormFields>
        </FormSection>

        <FormSection
          id="journey-new-schedule-group"
          title="Schedule"
          note="When the journey runs. All of it is optional and can be filled in later."
        >
          <FormFields>
            <FormRow>
              <AdminFormField
                id="journey-new-duration"
                label="Duration"
                hint="How long it takes, in words — Half day, Two days. Optional."
              >
                <input
                  id="journey-new-duration"
                  name="durationLabel"
                  type="text"
                  className="field-control"
                  maxLength={120}
                  aria-describedby="journey-new-duration-hint"
                />
              </AdminFormField>

              <AdminFormField
                id="journey-new-schedule"
                label="Schedule"
                hint="When it runs, in words — Daily, On request. Optional."
              >
                <input
                  id="journey-new-schedule"
                  name="scheduleLabel"
                  type="text"
                  className="field-control"
                  maxLength={120}
                  aria-describedby="journey-new-schedule-hint"
                />
              </AdminFormField>
            </FormRow>

            {/* A fieldset rather than a field: several checkboxes share one
                question, so the legend is the label for all of them. */}
            <fieldset className="adm-field">
              <legend className="field-label">Operating days</legend>
              <div className="adm-checkboxes">
                {PACKAGE_WEEKDAYS.map((day) => (
                  <label className="adm-checkbox" key={day} htmlFor={`journey-new-day-${day}`}>
                    <input
                      id={`journey-new-day-${day}`}
                      name="operatingDays"
                      type="checkbox"
                      value={day}
                    />
                    <span>{WEEKDAY_LABELS[day]}</span>
                  </label>
                ))}
              </div>
              <p className="field-hint" id="journey-new-days-hint">
                The days this journey runs on. Leave all of them unticked if it has no fixed days.
              </p>
            </fieldset>
          </FormFields>
        </FormSection>

        <FormSection
          id="journey-new-wording"
          title="Wording"
          note="What guests read about the journey. Both are optional and can be written later."
        >
          <FormFields>
            <AdminFormField
              id="journey-new-summary"
              label="Summary"
              hint="One line for the catalogue listing. Optional — leave it empty and the journey simply has none."
            >
              <input
                id="journey-new-summary"
                name="summary"
                type="text"
                className="field-control"
                maxLength={500}
                aria-describedby="journey-new-summary-hint"
              />
            </AdminFormField>

            <AdminFormField
              id="journey-new-description"
              label="Description"
              hint="The longer passage shown on the journey's own page. Optional."
            >
              <textarea
                id="journey-new-description"
                name="description"
                className="field-control"
                rows={5}
                maxLength={5000}
                aria-describedby="journey-new-description-hint"
              />
            </AdminFormField>
          </FormFields>
        </FormSection>

        {/* One tick box, and a note that says plainly what this section is
            not: a journey has no price of its own, so there is no amount to
            enter here and none is offered. */}
        <FormSection
          id="journey-new-pricing"
          title="Pricing behaviour"
          note="No amount is set here. A journey is priced through its variants and their rate tiers, added from the journey's own page once it exists. This one setting only says whether those tiers decide the price at all."
        >
          <FormFields>
            <div className="adm-field">
              <label className="adm-checkbox" htmlFor="journey-new-confirmation">
                <input
                  id="journey-new-confirmation"
                  name="requiresPriceConfirmation"
                  type="checkbox"
                  value="yes"
                  aria-describedby="journey-new-confirmation-hint"
                />
                <span>Price is quoted on request</span>
              </label>
              <p className="field-hint" id="journey-new-confirmation-hint">
                Tick this when the journey is priced case by case rather than from its rate tiers.
              </p>
            </div>
          </FormFields>
        </FormSection>

        <FormActions cancelHref={PACKAGES_PATH} cancelLabel="Cancel">
          <AdminActionButton tone="confirm" pendingLabel="Creating…">
            Create journey
          </AdminActionButton>
        </FormActions>
      </FormStack>
    </FormPage>
  );
}
