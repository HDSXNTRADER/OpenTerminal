"use client";

import { useMutation } from "@tanstack/react-query";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { symbolsParam } from "../../lib/symbol";
import { useTerminal, type WidgetInstance } from "../../store/terminal";

type NewsItem = { title: string; publisher: string; publishedAt: string | null };

const LANG_NAME = { pt: "Brazilian Portuguese", en: "English", es: "Spanish" } as const;

/** One-click AI summary of the day built from the user's lists, alerts, market recap and headlines. */
export default function BriefWidget({ widget }: { widget: WidgetInstance }) {
  const setWidgetSettings = useTerminal((s) => s.setWidgetSettings);
  const saved = widget.settings as { text?: string; at?: number } | undefined;

  const brief = useMutation({
    mutationFn: async () => {
      const st = useTerminal.getState();
      // Everything is best-effort: a missing source just leaves its part out.
      const safe = <T,>(p: Promise<T>) => p.catch(() => null);
      const symbols = [...new Set([...st.watchlist, st.activeSymbol])].slice(0, 40);
      const [quotes, recap, news] = await Promise.all([
        safe(apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`)),
        safe(apiGet<unknown>("/api/recap")),
        safe(apiGet<NewsItem[]>("/api/news")),
      ]);
      const context = {
        date: new Date().toISOString(),
        watchlist: (quotes ?? []).map((q) => ({ symbol: q.symbol, price: q.price, changePercent: q.changePercent })),
        alerts: st.alerts.map((a) => ({ symbol: a.symbol, level: a.price, direction: a.direction, triggered: !!a.triggeredAt })),
        marketRecap: recap,
        headlines: (news ?? []).slice(0, 20).map((n) => `${n.title} (${n.publisher})`),
      };
      const prompt =
        `Write my daily market brief in ${LANG_NAME[st.lang]}, using only the terminal context provided. ` +
        "Structure: 1) the market in two or three sentences; 2) my watchlist: the biggest movers and anything unusual; " +
        "3) my price alerts: which fired and which are close to the price; 4) the three headlines that matter most for my assets; " +
        "5) what to watch next. Be concise, use short bullet points, plain text without markdown tables. " +
        "Do not recommend buying or selling.";
      const res = await apiPost<{ text: string }>("/api/ai/chat", { messages: [{ role: "user", content: prompt }], context });
      return res.text;
    },
    onSuccess: (text) => setWidgetSettings(widget.id, { text, at: Date.now() }),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-1 items-center">
        <button className="term-btn" disabled={brief.isPending} onClick={() => brief.mutate()}>
          {brief.isPending ? t("thinking…") : `✦ ${t(saved?.text ? "Update brief" : "Generate today's brief")}`}
        </button>
        {saved?.at && <span className="dim text-[10px]">{t("Updated {time}", { time: new Date(saved.at).toLocaleString(locale()) })}</span>}
      </div>
      {brief.error && <div className="p-2 down">{t((brief.error as Error).message)}</div>}
      <div className="flex-1 overflow-auto px-2 pb-2 whitespace-pre-wrap leading-relaxed text-[12px] min-h-0">
        {saved?.text ?? (
          <span className="dim">
            {t("The AI reads your watchlist, alerts, the market recap and the latest headlines and writes a short summary of the day.")}
          </span>
        )}
      </div>
    </div>
  );
}
