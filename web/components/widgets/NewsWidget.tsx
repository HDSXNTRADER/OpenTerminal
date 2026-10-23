"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { t } from "../../lib/i18n";

type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };
type Mode = "symbol" | "global" | "financialjuice" | "bloomberg" | "yahoo";

// Publisher feeds served by /api/news?source=... (headlines only, links open the original site).
const FEEDS: Array<{ id: Mode; label: string; title: string }> = [
  { id: "financialjuice", label: "FJ", title: "FinancialJuice" },
  { id: "bloomberg", label: "BBG", title: "Bloomberg" },
  { id: "yahoo", label: "YHOO", title: "Yahoo Finance" },
];

function newsPath(mode: Mode, symbol: string): string {
  if (mode === "symbol") return `/api/news?symbol=${encodeURIComponent(symbol)}`;
  if (mode === "global") return "/api/news";
  return `/api/news?source=${mode}`;
}

export default function NewsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [mode, setMode] = useState<Mode>("symbol");

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["news", mode, symbol],
    queryFn: () => apiGet<NewsItem[]>(newsPath(mode, symbol)),
    refetchInterval: 30_000,
  });

  return (
    <div>
      <div className="flex flex-wrap gap-1 p-1">
        <button className={`term-btn ${mode === "symbol" ? "active" : ""}`} onClick={() => setMode("symbol")}>
          {symbol}
        </button>
        <button className={`term-btn ${mode === "global" ? "active" : ""}`} onClick={() => setMode("global")}>
          {t("GLOBAL")}
        </button>
        {FEEDS.map((f) => (
          <button key={f.id} className={`term-btn ${mode === f.id ? "active" : ""}`} title={f.title} onClick={() => setMode(f.id)}>
            {f.label}
          </button>
        ))}
        {/* Finviz has no public feed and forbids scraping, so we only link to it. */}
        <a className="term-btn" href="https://finviz.com/news.ashx" target="_blank" rel="noreferrer" title={t("Open Finviz news in the browser")}>
          FINVIZ ↗
        </a>
      </div>
      {isLoading && <div className="p-2 dim">{t("Loading news…")}</div>}
      {isError && <div className="p-2 dim">{t("News source unavailable right now.")}</div>}
      {data.map((n, i) => {
        const body = (
          <>
            <div className="truncate">{n.title}</div>
            <div className="dim text-[10px]">
              {n.publisher}
              {n.publishedAt ? " · " + new Date(n.publishedAt).toLocaleString() : ""}
            </div>
          </>
        );
        const className = "block px-2 py-1 border-b border-[var(--line)] hover:bg-[var(--hover)]";
        return isSafeHttpUrl(n.link) ? (
          <a key={i} href={n.link} target="_blank" rel="noreferrer" className={className}>
            {body}
          </a>
        ) : (
          <div key={i} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
