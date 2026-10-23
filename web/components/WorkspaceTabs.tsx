"use client";

import { useRef, useState } from "react";
import { t } from "../lib/i18n";
import Presentation from "./Presentation";
import { exportBackup, useTerminal } from "../store/terminal";

/** Tabs for saved layouts ("Day trade", "Swing"...). Double-click a tab to rename it. */
export default function WorkspaceTabs() {
  const workspaces = useTerminal((s) => s.workspaces);
  const active = useTerminal((s) => s.activeWorkspace);
  const switchWorkspace = useTerminal((s) => s.switchWorkspace);
  const addWorkspace = useTerminal((s) => s.addWorkspace);
  const renameWorkspace = useTerminal((s) => s.renameWorkspace);
  const deleteWorkspace = useTerminal((s) => s.deleteWorkspace);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const importBackup = useTerminal((s) => s.importBackup);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportBackup(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openterminal-layouts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const doImport = async (file: File) => {
    try {
      const n = importBackup(JSON.parse(await file.text()));
      window.alert(t("Imported {n} layout(s). They were added as new tabs.", { n }));
    } catch (err) {
      window.alert(t("Could not import this file: {msg}", { msg: t((err as Error).message) }));
    }
  };

  const commitRename = () => {
    if (editing && draft.trim()) renameWorkspace(editing, draft.trim().slice(0, 30));
    setEditing(null);
  };

  return (
    <div className="flex items-stretch gap-px h-6 bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px] shrink-0 overflow-x-auto">
      {workspaces.map((ws) => {
        const isActive = ws.id === active;
        return (
          <div
            key={ws.id}
            className={`group flex items-center gap-1 px-3 cursor-pointer border-r border-[var(--border)] ${
              isActive ? "bg-[var(--panel)] text-[var(--amber)]" : "dim hover:text-[var(--text)]"
            }`}
            onClick={() => switchWorkspace(ws.id)}
            onDoubleClick={() => {
              setEditing(ws.id);
              setDraft(ws.name);
            }}
            title={t("Double-click to rename")}
          >
            {editing === ws.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-24 !border-0 !border-b !border-[var(--amber-dim)] bg-transparent px-0 py-0 text-[11px]"
              />
            ) : (
              <span>{ws.name}</span>
            )}
            {workspaces.length > 1 && (
              <button
                className="opacity-0 group-hover:opacity-100 dim hover:text-[var(--down)]"
                title={t("Delete this layout")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(t("Delete the layout “{name}”?", { name: ws.name }))) deleteWorkspace(ws.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      <button
        className="px-3 dim hover:text-[var(--amber)]"
        title={t("New layout")}
        onClick={() => {
          const name = window.prompt(t("Name of the new layout:"), t("Layout {n}", { n: workspaces.length + 1 }));
          if (name && name.trim()) addWorkspace(name.trim().slice(0, 30));
        }}
      >
        + {t("New layout")}
      </button>
      <span className="ml-auto" />
      <Presentation />
      <button className="px-3 dim hover:text-[var(--amber)]" title={t("Save layouts, lists, drawings and alerts to a file")} onClick={doExport}>
        ⤓ {t("Export")}
      </button>
      <button className="px-3 dim hover:text-[var(--amber)]" title={t("Load layouts from an exported file")} onClick={() => fileRef.current?.click()}>
        ⤒ {t("Import")}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
