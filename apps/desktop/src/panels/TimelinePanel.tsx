import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

export function TimelinePanel() {
  const timeline = useAppStore((state) => state.timeline);
  const sessionMemory = useAppStore((state) => state.sessionMemory);
  const clearTimeline = useAppStore((state) => state.clearTimeline);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">Execution Timeline</div>
          <Button onClick={() => clearTimeline()}>Clear</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted">
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-1 text-[10px] uppercase">Goal</div>
            <div className="line-clamp-2 text-text">{sessionMemory.currentGoal || "No active goal"}</div>
          </div>
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-1 text-[10px] uppercase">Project</div>
            <div className="text-text">{sessionMemory.projectType || "Unknown"}</div>
            <div>{sessionMemory.currentBranch ? `Branch: ${sessionMemory.currentBranch}` : "No git branch detected"}</div>
          </div>
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-1 text-[10px] uppercase">Preview</div>
            <div className="text-text">{sessionMemory.previewMode}</div>
            <div className="truncate">{sessionMemory.activePreviewUrl || "No active preview URL"}</div>
          </div>
          <div className="rounded border border-border bg-black/20 p-2">
            <div className="mb-1 text-[10px] uppercase">Verify</div>
            <div className="text-text">{sessionMemory.verificationStatus}</div>
            <div>
              {sessionMemory.filesTouched.length
                ? `${sessionMemory.filesTouched.length} touched file${sessionMemory.filesTouched.length === 1 ? "" : "s"}`
                : "No files touched yet"}
            </div>
          </div>
        </div>
        {(sessionMemory.detectedScripts.length > 0 || sessionMemory.knownBlockers.length > 0) && (
          <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2">
            <div className="rounded border border-border bg-black/20 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">Detected Scripts</div>
              <div className="flex flex-wrap gap-1">
                {sessionMemory.detectedScripts.map((script) => (
                  <span key={script} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text">
                    {script}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded border border-border bg-black/20 p-2">
              <div className="mb-1 text-[10px] uppercase text-muted">Known Blockers</div>
              {sessionMemory.knownBlockers.length ? (
                <div className="space-y-1">
                  {sessionMemory.knownBlockers.map((blocker) => (
                    <div key={blocker} className="text-bad">
                      {blocker}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted">No blockers recorded.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="lumen-scroll flex-1 overflow-auto p-2 text-[11px]">
        {timeline.length === 0 && <div className="text-muted">No execution events yet.</div>}
        {timeline
          .slice()
          .reverse()
          .map((entry) => (
            <div key={entry.id} className="mb-2 rounded border border-border bg-black/20 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted">{entry.phase}</span>
                  <span className="text-text">{entry.title}</span>
                </div>
                <span
                  className={`text-[10px] uppercase ${
                    entry.status === "failed"
                      ? "text-bad"
                      : entry.status === "blocked"
                        ? "text-warn"
                        : entry.status === "running"
                          ? "text-accent"
                          : "text-muted"
                  }`}
                >
                  {entry.status}
                </span>
              </div>
              <div className="mb-1 text-muted">{entry.detail}</div>
              <div className="flex items-center justify-between text-[10px] text-muted">
                <span>{entry.source}</span>
                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
