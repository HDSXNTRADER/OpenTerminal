"use client";

import { useEffect } from "react";
import { FUNCTIONS } from "../lib/commands";
import { t } from "../lib/i18n";
import { useTerminal } from "../store/terminal";

const SHORTCUTS: Array<[string, string]> = [
  ["F1", "This help"],
  ["F2", "Go to the command line"],
  ["F3", "Maximize / restore the widget under the mouse"],
  ["F4 / Shift+F4", "Next / previous layout"],
  ["F8", "Light / dark theme"],
  ["F9", "Start / stop the presentation"],
  ["Ctrl+K", "Search by company name"],
  ["Alt+1…9", "Add chart, quote, news, screener, heatmap, crypto, options, portfolio, AI"],
  ["Esc", "Close / restore"],
];

/** Every command code and keyboard shortcut on one screen (F1 or HELP). */
export default function HelpOverlay() {
  const open = useTerminal((s) => s.helpOpen);
  const setOpen = useTerminal((s) => s.setHelpOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
      <div
        className="w-[900px] max-w-[95vw] max-h-[85vh] overflow-auto bg-[var(--panel)] border border-[var(--amber-dim)] p-3 text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between mb-2">
          <span className="amber font-bold">{t("Commands and shortcuts")}</span>
          <button className="dim hover:text-[var(--amber)]" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <p className="dim mb-2">
          {t("In the command line at the top, type a ticker, a function code, or both, then Enter. Examples:")}{" "}
          <span className="amber">PETR4 GP</span> · <span className="amber">AAPL DES</span> · <span className="amber">VALE3 FA</span> ·{" "}
          <span className="amber">WEI</span> · <span className="amber">MSFT</span>
        </p>
        <div className="grid grid-cols-2 gap-x-6">
          <table className="data-table">
            <tbody>
              {FUNCTIONS.map((f) => (
                <tr key={f.type}>
                  <td className="amber font-bold">{f.codes.join(" · ")}</td>
                  <td className="!text-left">{t(f.desc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <table className="data-table">
              <tbody>
                {SHORTCUTS.map(([k, d]) => (
                  <tr key={k}>
                    <td className="amber font-bold">{k}</td>
                    <td className="!text-left whitespace-normal">{t(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dim mt-3 whitespace-normal">
              {t("Link colors: click ⛓ on a widget to put it in a color group. Widgets with the same color share their own ticker, so you can follow two companies at once.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
