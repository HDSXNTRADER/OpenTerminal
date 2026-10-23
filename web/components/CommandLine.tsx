"use client";

import { useEffect, useRef, useState } from "react";
import { FUNCTIONS, runCommand } from "../lib/commands";
import { t } from "../lib/i18n";
import { useTerminal } from "../store/terminal";

/** Focuses the command line from anywhere (F2). */
export function focusCommandLine() {
  document.getElementById("command-line")?.focus();
}

/**
 * Bloomberg-style command line: type "PETR4 GP", "AAPL DES", "WEI" or a ticker, then Enter.
 * Suggests function codes while typing; Tab completes the highlighted one.
 */
export default function CommandLine() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const history = useRef<string[]>([]);
  const historyAt = useRef(-1);

  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(id);
  }, [feedback]);

  const words = value.trim().toUpperCase().split(/\s+/);
  const lastWord = value.endsWith(" ") ? "" : words[words.length - 1] ?? "";
  const suggestions =
    focused && value.trim()
      ? FUNCTIONS.filter((f) => f.codes.some((c) => lastWord && c.startsWith(lastWord))).slice(0, 8)
      : [];

  const complete = (code: string) => {
    const base = value.endsWith(" ") ? value : value.slice(0, value.length - lastWord.length);
    return `${base}${code}`;
  };

  const submit = (text: string) => {
    const res = runCommand(text);
    if (res.ok) {
      history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 30);
      setValue("");
      if (res.message) setFeedback({ ok: true, text: res.message });
    } else if (res.message) setFeedback({ ok: false, text: t(res.message) });
    historyAt.current = -1;
  };

  return (
    <div className="relative flex-1 max-w-md flex items-center gap-1">
      <span className="amber font-bold">&gt;</span>
      <input
        id="command-line"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value.toUpperCase());
          setSelected(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // A partly typed code with a single match runs that function ("AAPL DE" + Enter = DES).
            const exact = suggestions.some((f) => f.codes.includes(lastWord));
            // Only after a ticker: a lone "T" is AT&T, not the start of "TV".
            const auto = !exact && words.length > 1 && suggestions.length === 1;
            submit(auto ? complete(suggestions[0].codes[0]) : value);
          } else if (e.key === "Tab" && suggestions[selected]) {
            e.preventDefault();
            setValue(complete(suggestions[selected].codes.find((c) => c.startsWith(lastWord)) ?? suggestions[selected].codes[0]));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (suggestions.length) setSelected((s) => Math.min(s + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (suggestions.length) setSelected((s) => Math.max(s - 1, 0));
            else if (history.current.length) {
              historyAt.current = Math.min(historyAt.current + 1, history.current.length - 1);
              setValue(history.current[historyAt.current]);
            }
          } else if (e.key === "Escape") {
            setValue("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={`${activeSymbol} — ${t("type a ticker and/or a function: PETR4 GP, AAPL DES, WEI… (F1 help)")}`}
        className="flex-1 !py-0.5 text-[11px]"
      />
      <button className="term-btn !py-0" title={t("Search by company name (Ctrl+K)")} onClick={() => setCommandOpen(true)}>
        ⌕
      </button>
      {feedback && (
        <span className={`absolute right-8 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${feedback.ok ? "up" : "down"}`}>
          {feedback.ok ? "✓ " : "✕ "}
          {feedback.text}
        </span>
      )}
      {suggestions.length > 0 && (
        <div className="absolute left-3 top-full mt-1 z-50 w-80 bg-[var(--panel)] border border-[var(--amber-dim)] shadow-lg">
          {suggestions.map((f, i) => (
            <div
              key={f.type}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(complete(f.codes[0]));
              }}
              className={`px-2 py-1 flex gap-2 cursor-pointer ${i === selected ? "bg-[var(--select)] text-[var(--amber)]" : "hover:bg-[var(--hover)]"}`}
            >
              <span className="w-16 font-bold amber">{f.codes[0]}</span>
              <span className="flex-1 truncate">{t(f.desc)}</span>
              {f.ticker && <span className="dim text-[10px]">{t("uses ticker")}</span>}
            </div>
          ))}
          <div className="dim text-[10px] px-2 py-1 border-t border-[var(--border)]">{t("Enter = run · Tab = complete · ↑↓ = choose")}</div>
        </div>
      )}
    </div>
  );
}
