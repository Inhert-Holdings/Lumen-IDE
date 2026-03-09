import "xterm/css/xterm.css";

import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/useAppStore";

type TerminalRecord = {
  terminal: Terminal;
  fit: FitAddon;
};

export function TerminalPanel() {
  const terminalTabs = useAppStore((state) => state.terminalTabs);
  const activeTerminalId = useAppStore((state) => state.activeTerminalId);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);
  const closeTerminalTab = useAppStore((state) => state.closeTerminalTab);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const recordsRef = useRef<Map<string, TerminalRecord>>(new Map());

  const ensureMounted = (id: string) => {
    const container = containersRef.current.get(id);
    if (!container || recordsRef.current.has(id)) return;

    const terminal = new Terminal({
      convertEol: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#0b111a",
        foreground: "#d9e2ef",
        cursor: "#4ac8ff"
      }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminal.focus();

    terminal.onData((data) => {
      void window.lumen.terminal.write({ id, data });
    });

    recordsRef.current.set(id, { terminal, fit });
  };

  const createTerminal = async () => {
    const created = await window.lumen.terminal.create({ cols: 120, rows: 30 });
    addTerminalTab({ id: created.id, title: created.id });
    setTimeout(() => ensureMounted(created.id), 0);
  };

  const killTerminal = async (id: string) => {
    await window.lumen.terminal.kill({ id });
    const record = recordsRef.current.get(id);
    if (record) {
      record.terminal.dispose();
      recordsRef.current.delete(id);
    }
    closeTerminalTab(id);
  };

  useEffect(() => {
    const unsubscribeData = window.lumen.terminal.onData(({ id, data }) => {
      const record = recordsRef.current.get(id);
      if (record) {
        record.terminal.write(data);
      }
    });

    const unsubscribeExit = window.lumen.terminal.onExit(({ id }) => {
      const record = recordsRef.current.get(id);
      if (record) {
        record.terminal.write("\r\n[process exited]\r\n");
      }
    });

    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }, []);

  useEffect(() => {
    const resize = () => {
      const active = activeTerminalId ? recordsRef.current.get(activeTerminalId) : null;
      active?.fit.fit();
      if (activeTerminalId) {
        const cols = active?.terminal.cols ?? 120;
        const rows = active?.terminal.rows ?? 30;
        void window.lumen.terminal.resize({ id: activeTerminalId, cols, rows });
      }
    };

    const observer = new ResizeObserver(() => resize());
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [activeTerminalId]);

  useEffect(() => {
    for (const tab of terminalTabs) {
      ensureMounted(tab.id);
    }
  }, [terminalTabs]);

  useEffect(() => {
    if (!activeTerminalId && terminalTabs.length > 0) {
      setActiveTerminal(terminalTabs[0].id);
    }
    if (activeTerminalId) {
      const record = recordsRef.current.get(activeTerminalId);
      record?.fit.fit();
      record?.terminal.focus();
    }
  }, [activeTerminalId, terminalTabs, setActiveTerminal]);

  return (
    <div ref={rootRef} className="flex h-full flex-col border-t border-border bg-[#0a1018]">
      <div className="border-b border-border px-2 py-1.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Terminal</div>
            <div className="text-[12px] text-text">{activeTerminalId || "No active session"}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="shell-pill">{terminalTabs.length} session{terminalTabs.length === 1 ? "" : "s"}</span>
            <Button onClick={() => void createTerminal()}>New</Button>
            <Button
              onClick={() => {
                if (activeTerminalId) {
                  void window.lumen.terminal.write({ id: activeTerminalId, data: "cls\r" });
                }
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="lumen-scroll flex items-center gap-1 overflow-x-auto">
          {terminalTabs.map((tab) => (
            <button
              key={tab.id}
              className={`flex h-7 items-center gap-2 rounded border px-2 text-[11px] transition ${
                tab.id === activeTerminalId
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-transparent bg-black/20 text-muted hover:text-text"
              }`}
              onClick={() => setActiveTerminal(tab.id)}
            >
              <span>{tab.title}</span>
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  void killTerminal(tab.id);
                }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 bg-[#0b111a]">
        {terminalTabs.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            No terminals. Click New or press Ctrl+Shift+`.
          </div>
        )}

        {terminalTabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => {
              if (el) containersRef.current.set(tab.id, el);
            }}
            className={`${tab.id === activeTerminalId ? "block" : "hidden"} absolute inset-0 p-1`}
          />
        ))}
      </div>
    </div>
  );
}
