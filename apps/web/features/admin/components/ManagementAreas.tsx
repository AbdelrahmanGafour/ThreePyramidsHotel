import { adminNavigation } from "../data/adminNavigation";
import { PanelHeader } from "./PanelHeader";

const areas = adminNavigation.filter((item) => !item.available);

// Informational only — these areas open one by one as they are built, so
// nothing here is a button or link.
export function ManagementAreas() {
  return (
    <section className="adm-panel" aria-labelledby="areas-title">
      <PanelHeader
        id="areas-title"
        title="Management areas"
        note="Coming next, one area at a time."
      />
      <ul className="adm-areas">
        {areas.map((area) => (
          <li key={area.key}>
            <span className="adm-strong">{area.label}</span>
            <span className="adm-sub">{area.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
