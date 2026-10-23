"use client";

import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useTerminal } from "../store/terminal";

const SPEEDS = [10, 20, 30, 60];

/** Button + engine for presentation mode: full screen, rotating through the saved layouts. */
export default function Presentation() {
  const presenting = useTerminal((s) => s.presenting);
  const setPresenting = useTerminal((s) => s.setPresenting);
  const workspaces = useTerminal((s) => s.workspaces);
  const [speed, setSpeed] = useState(20);

  useEffect(() => {
    if (!presenting) return;
    const timer = setInterval(() => {
      const st = useTerminal.getState();
      if (st.workspaces.length < 2) return;
      const i = st.workspaces.findIndex((w) => w.id === st.activeWorkspace);
      st.switchWorkspace(st.workspaces[(i + 1) % st.workspaces.length].id);
    }, presenting * 1000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresenting(0);
    // Leaving browser full screen (F11/Esc) also ends the presentation.
    const onFs = () => !document.fullscreenElement && setPresenting(0);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [presenting, setPresenting]);

  const start = () => {
    setPresenting(speed);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const stop = () => {
    setPresenting(0);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  if (presenting)
    return (
      <button className="px-3 amber" onClick={stop} title={t("Stop the presentation (Esc)")}>
        ■ {t("Stop")}
      </button>
    );
  return (
    <span className="flex items-center gap-1 px-2" title={t("Full screen, switching layouts automatically")}>
      <button className="dim hover:text-[var(--amber)]" onClick={start} disabled={workspaces.length < 1}>
        ▶ {t("Presentation")}
      </button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="!py-0 text-[10px]">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}s
          </option>
        ))}
      </select>
    </span>
  );
}
