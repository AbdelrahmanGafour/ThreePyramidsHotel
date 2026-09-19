import { demoInquiries, demoToday, getJourneyTitle } from "../data/adminDemoData";
import { formatReceived } from "../lib/format";
import { inquiryStatus } from "../lib/status";
import type { AdminInquiry } from "../types";
import { PanelHeader } from "./PanelHeader";
import { StatusBadge } from "./StatusBadge";

const kindLabel = { journey: "Journey inquiry", stay: "Stay question", general: "General contact" } as const;

const topic = (i: AdminInquiry) => getJourneyTitle(i.journeySlug) ?? "No journey attached";
const inquiries = [...demoInquiries].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

export function LatestInquiries() {
  return (
    <section className="adm-panel" aria-labelledby="inquiries-title">
      <PanelHeader
        id="inquiries-title"
        title="Latest inquiries"
        note="Messages from the website’s contact and journey forms."
      />

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Guest</th>
              <th scope="col">Inquiry</th>
              <th scope="col">Received</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {inquiries.map((i) => (
              <tr key={i.id}>
                <th scope="row" className="adm-cell-primary">
                  <span className="adm-strong">{i.guestName}</span>
                  <span className="adm-sub">{i.id}</span>
                </th>
                <td>
                  <span className="adm-strong">{kindLabel[i.kind]}</span>
                  {i.kind === "journey" ? <span className="adm-sub">{topic(i)}</span> : null}
                </td>
                <td>{formatReceived(i.receivedAt, demoToday)}</td>
                <td>
                  <StatusBadge meta={inquiryStatus[i.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="adm-list">
        {inquiries.map((i) => (
          <li key={i.id}>
            <div className="adm-list-top">
              <span className="adm-strong">{i.guestName}</span>
              <StatusBadge meta={inquiryStatus[i.status]} />
            </div>
            <p className="adm-sub">
              {kindLabel[i.kind]}
              {i.kind === "journey" ? `, ${topic(i)}` : ""}
            </p>
            <p className="adm-sub">{formatReceived(i.receivedAt, demoToday)}</p>
          </li>
        ))}
      </ul>

      <p className="adm-panel-foot">Replying and status changes arrive with the Inquiries area.</p>
    </section>
  );
}
