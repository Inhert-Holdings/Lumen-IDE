import type { TimelineEntry } from "@/state/useAppStore";
import type { AuditEntry } from "@/types/electron";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function countLabel(value: unknown, singular: string, plural: string) {
  const count = typeof value === "number" ? value : Number(value) || 0;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function createTimelineEntry(entry: Omit<TimelineEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }): TimelineEntry {
  return {
    id: entry.id || `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    phase: entry.phase,
    status: entry.status,
    title: entry.title,
    detail: entry.detail,
    source: entry.source
  };
}

export function timelineFromAudit(entry: AuditEntry): TimelineEntry | null {
  const detail = entry.detail || {};

  switch (entry.action) {
    case "workspace.open":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "scope",
        status: "done",
        title: "Workspace opened",
        detail: text(detail.root) || "Workspace root changed",
        source: "workbench"
      });
    case "terminal.create":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "done",
        title: "Terminal created",
        detail: text(detail.id) || "Interactive shell ready",
        source: "terminal"
      });
    case "terminal.kill":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "info",
        title: "Terminal closed",
        detail: text(detail.id) || "Terminal session ended",
        source: "terminal"
      });
    case "preview.start":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "done",
        title: "Static preview live",
        detail: text(detail.rootPath) || "Static folder is serving",
        source: "preview"
      });
    case "preview.project_start":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "done",
        title: "Project preview live",
        detail: `${text(detail.command) || "Dev command"} → ${text(detail.url) || "preview url"}`,
        source: "preview"
      });
    case "preview.stop":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "info",
        title: "Preview stopped",
        detail: text(detail.reason) || "Preview runtime stopped",
        source: "preview"
      });
    case "preview.project_stop":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "info",
        title: "Project preview stopped",
        detail: text(detail.reason) || text(detail.command) || "Project preview runtime stopped",
        source: "preview"
      });
    case "preview.browser_connect":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "verify",
        status: "done",
        title: "Browser connected",
        detail: text(detail.url) || "Playwright attached to preview",
        source: "preview"
      });
    case "preview.browser_click":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "verify",
        status: "done",
        title: "Browser click",
        detail: text(detail.selector) || "Clicked preview element",
        source: "preview"
      });
    case "preview.browser_type":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "verify",
        status: "done",
        title: "Browser input",
        detail: text(detail.selector) || "Filled preview element",
        source: "preview"
      });
    case "preview.browser_press":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "verify",
        status: "done",
        title: "Browser keypress",
        detail: text(detail.key) || "Sent key to preview",
        source: "preview"
      });
    case "agent.plan":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "plan",
        status: "done",
        title: "Plan created",
        detail: text(detail.goal) || "Agent generated a task plan",
        source: "agent"
      });
    case "agent.fast_edit":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "execute",
        status: "done",
        title: "Fast edit prepared",
        detail: text(detail.path) || "Direct file edit prepared",
        source: "agent"
      });
    case "agent.run_cmd":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "execute",
        status: "running",
        title: "Command executed",
        detail: text(detail.command) || "Workspace command sent to terminal",
        source: "agent"
      });
    case "agent.verify":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "verify",
        status: detail.ok ? "done" : "failed",
        title: "Verification finished",
        detail: detail.ok ? "Checks passed" : text(detail.error) || "Checks failed",
        source: "agent"
      });
    case "agent.propose":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "propose",
        status: "done",
        title: "Patch proposal ready",
        detail: countLabel(detail.pendingChanges, "pending change", "pending changes"),
        source: "agent"
      });
    case "agent.denied":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "execute",
        status: "blocked",
        title: "Action denied",
        detail: text(detail.type) || "Approval request denied",
        source: "agent"
      });
    case "agent.skip":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "execute",
        status: "blocked",
        title: "Action skipped",
        detail: text(detail.reason) || text(detail.type) || "Agent skipped a tool action",
        source: "agent"
      });
    case "git.commit":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "apply",
        status: "done",
        title: "Git commit created",
        detail: text(detail.message) || "Commit written to repository",
        source: "git"
      });
    case "git.push":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "apply",
        status: "done",
        title: "Git push completed",
        detail: "Remote branch updated",
        source: "git"
      });
    case "runtime.low_resource_mode":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "runtime",
        status: "info",
        title: "Low resource mode changed",
        detail: detail.enabled ? "Low resource mode enabled" : "Low resource mode disabled",
        source: "system"
      });
    case "policy.set_preset":
      return createTimelineEntry({
        id: entry.id,
        timestamp: entry.timestamp,
        phase: "scope",
        status: "info",
        title: "Trust preset changed",
        detail: text(detail.preset) || "Permission preset updated",
        source: "system"
      });
    default:
      if (entry.action.startsWith("agent.")) {
        return createTimelineEntry({
          id: entry.id,
          timestamp: entry.timestamp,
          phase: "execute",
          status: detail.ok === false ? "failed" : "done",
          title: entry.action.replace(/^agent\./, "").replace(/_/g, " "),
          detail: text(detail.reason) || text(detail.error) || "Agent tool step completed",
          source: "agent"
        });
      }
      return null;
  }
}

export function timelineFromAuditList(entries: AuditEntry[]) {
  return entries.map((entry) => timelineFromAudit(entry)).filter((entry): entry is TimelineEntry => Boolean(entry));
}
