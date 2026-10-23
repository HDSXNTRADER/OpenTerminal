"use client";

import { useEffect } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import Workspace from "./Workspace";
import CommandPalette from "./CommandPalette";
import WorkspaceTabs from "./WorkspaceTabs";
import AlertWatcher from "./AlertWatcher";
import HelpOverlay from "./HelpOverlay";
import { focusCommandLine } from "./CommandLine";
import { hovered } from "../lib/commands";
import { useTerminal } from "../store/terminal";

export default function Terminal() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const addWidget = useTerminal((s) => s.addWidget);
  const lang = useTerminal((s) => s.lang);
  const theme = useTerminal((s) => s.theme);
  const accent = useTerminal((s) => s.accent);
  const presenting = useTerminal((s) => s.presenting);

  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : lang;
  }, [lang]);

  // Set before children render (layout effect would be too late for the first chart paint on remount).
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      const fkeys: Record<string, () => void> = {
        F1: () => useTerminal.getState().setHelpOpen(!useTerminal.getState().helpOpen),
        F2: focusCommandLine,
        F3: () => {
          const st = useTerminal.getState();
          if (st.maximized) st.setMaximized(null);
          else if (hovered.id) st.setMaximized(hovered.id);
        },
        F4: () => {
          const st = useTerminal.getState();
          const i = st.workspaces.findIndex((w) => w.id === st.activeWorkspace);
          const n = st.workspaces.length;
          st.switchWorkspace(st.workspaces[(i + (e.shiftKey ? n - 1 : 1)) % n].id);
        },
        F8: () => {
          const st = useTerminal.getState();
          st.setTheme(st.theme === "dark" ? "light" : "dark");
        },
        F9: () => {
          const st = useTerminal.getState();
          if (st.presenting) {
            st.setPresenting(0);
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          } else {
            st.setPresenting(20);
            document.documentElement.requestFullscreen?.().catch(() => {});
          }
        },
      };
      if (fkeys[e.key] && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        fkeys[e.key]();
        return;
      }
      if (e.altKey) {
        const map: Record<string, () => void> = {
          "1": () => addWidget("chart"),
          "2": () => addWidget("quote"),
          "3": () => addWidget("news"),
          "4": () => addWidget("screener"),
          "5": () => addWidget("heatmap"),
          "6": () => addWidget("crypto"),
          "7": () => addWidget("options"),
          "8": () => addWidget("portfolio"),
          "9": () => addWidget("ai"),
        };
        const fn = map[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, addWidget]);

  return (
    // Re-mount on language/theme change so every widget re-renders its labels and chart colours.
    <div key={`${lang}-${theme}-${accent}`} className="flex flex-col h-screen">
      {!presenting && <TopBar />}
      <div className="flex flex-1 overflow-hidden">
        {!presenting && <Sidebar />}
        <main className="flex-1 flex flex-col min-w-0">
          <WorkspaceTabs />
          <div className="flex-1 overflow-auto min-h-0">
            <Workspace />
          </div>
        </main>
      </div>
      <CommandPalette />
      <AlertWatcher />
      <HelpOverlay />
    </div>
  );
}
