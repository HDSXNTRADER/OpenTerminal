"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal, type Accent, type Lang } from "../store/terminal";

const ACCENTS: Array<{ id: Accent; color: string }> = [
  { id: "amber", color: "#ff9900" },
  { id: "blue", color: "#2f9bff" },
  { id: "green", color: "#19c37d" },
  { id: "purple", color: "#b07cff" },
];
import { LANGS, t } from "../lib/i18n";

type Status = {
  ok: boolean;
  providers: Array<{ name: string; ok: number; failed: number; lastLatencyMs: number | null }>;
  ai: boolean;
};

function Clock({ tz, label }: { tz: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="dim">
      {label}{" "}
      <span className="text-[var(--text)]">
        {now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false })}
      </span>
    </span>
  );
}

function marketStateNY(): { label: string; open: boolean } {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 09:30–16:00
  return { label: t(open ? "NYSE OPEN" : "NYSE CLOSED"), open };
}

export default function TopBar() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const lang = useTerminal((s) => s.lang);
  const setLang = useTerminal((s) => s.setLang);
  const theme = useTerminal((s) => s.theme);
  const setTheme = useTerminal((s) => s.setTheme);
  const accent = useTerminal((s) => s.accent);
  const setAccent = useTerminal((s) => s.setAccent);
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<Status>("/api/status"),
    refetchInterval: 30_000,
  });

  const market = marketStateNY();
  const healthy = status?.providers.filter((p) => p.ok > 0) ?? [];

  return (
    <header className="flex items-center gap-4 px-3 h-8 bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px] shrink-0">
      <span className="amber font-bold tracking-widest">OPENTERMINAL</span>
      <span className={market.open ? "up" : "down"}>● {market.label}</span>
      <Clock tz="America/New_York" label="NY" />
      <Clock tz="Europe/Rome" label="MIL" />
      <Clock tz="Europe/London" label="LDN" />
      <Clock tz="Asia/Tokyo" label="TYO" />
      <button
        className="term-btn flex-1 max-w-md text-left dim"
        onClick={() => setCommandOpen(true)}
      >
        {activeSymbol} — {t("search symbol…")} <span className="float-right">⌘K</span>
      </button>
      <span className="dim ml-auto">
        {t("feeds")}:{" "}
        {healthy.length > 0
          ? healthy.map((p) => `${p.name} ${p.lastLatencyMs ?? "—"}ms`).join(" · ")
          : t("connecting…")}
      </span>
      <span className={status?.ai ? "up" : "dim"}>AI {status?.ai ? "●" : "○"}</span>
      <button
        className="term-btn !py-0"
        title={t(theme === "dark" ? "Switch to light theme" : "Switch to dark theme")}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <span className="flex gap-1 items-center" title={t("Accent colour")}>
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAccent(a.id)}
            className={`w-3 h-3 rounded-full border ${accent === a.id ? "border-[var(--text)]" : "border-transparent"}`}
            style={{ background: a.color }}
            aria-label={a.id}
          />
        ))}
      </span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        title={t("Language")}
        className="term-btn !py-0 bg-[var(--panel)] cursor-pointer"
      >
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </header>
  );
}
