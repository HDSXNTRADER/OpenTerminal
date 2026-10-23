"use client";

import { useState } from "react";
import { t } from "../lib/i18n";
import { useTerminal } from "../store/terminal";

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
    </div>
  );
}
