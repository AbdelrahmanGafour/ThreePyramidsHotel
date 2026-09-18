export function PanelHeader({ id, title, note }: { id: string; title: string; note?: string }) {
  return (
    <div className="adm-panel-head">
      <h2 id={id} className="adm-panel-title">
        {title}
      </h2>
      {note ? <p className="adm-panel-note">{note}</p> : null}
    </div>
  );
}
