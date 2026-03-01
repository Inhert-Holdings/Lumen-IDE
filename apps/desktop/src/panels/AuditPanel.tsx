import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

export function AuditPanel() {
  const audit = useAppStore((state) => state.audit);
  const replaceAudit = useAppStore((state) => state.replaceAudit);

  const clear = async () => {
    await window.lumen.audit.clear();
    const refreshed = await window.lumen.audit.list();
    replaceAudit(refreshed.entries);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
        <span className="text-muted">Audit log</span>
        <Button onClick={() => void clear()}>Clear</Button>
      </div>
      <div className="lumen-scroll flex-1 overflow-auto p-2 text-[11px]">
        {audit.length === 0 && <div className="text-muted">No audit entries yet.</div>}
        {audit
          .slice()
          .reverse()
          .map((entry) => (
            <div key={entry.id} className="mb-2 rounded border border-border bg-black/20 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-accent">{entry.action}</span>
                <span className="text-muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words text-[11px] text-muted">{JSON.stringify(entry.detail, null, 2)}</pre>
            </div>
          ))}
      </div>
    </div>
  );
}
