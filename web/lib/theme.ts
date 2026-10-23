"use client";

/** Reads a theme colour from the CSS variables (see globals.css) for canvas/SVG charts. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Colours for lightweight-charts, following the current theme. */
export function chartColors() {
  return {
    background: cssVar("--panel"),
    text: cssVar("--text-dim"),
    grid: cssVar("--line"),
    border: cssVar("--border"),
    up: cssVar("--up"),
    down: cssVar("--down"),
    accent: cssVar("--amber"),
  };
}
