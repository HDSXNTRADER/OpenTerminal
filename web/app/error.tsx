"use client";

import { useEffect } from "react";
import { t } from "../lib/i18n";

// Route-level fallback for errors outside any widget (top bar, sidebar, layout grid).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-4 flex flex-col gap-2 items-start">
      <span className="down">{t("Terminal error: {msg}", { msg: error.message })}</span>
      <button onClick={reset} className="dim hover:text-[var(--amber)]">
        {t("Retry")}
      </button>
    </div>
  );
}
