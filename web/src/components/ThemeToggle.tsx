"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };
const ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("theme");
    } catch {}
    setTheme(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  // In "system" mode, follow OS changes live.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme ?? "system") + 1) % ORDER.length] ?? "system";
    setTheme(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
  }

  const current = theme ?? "system";
  return (
    <button
      type="button"
      onClick={cycle}
      title="Switch colour theme"
      aria-label={`Colour theme: ${LABEL[current]}. Click to change.`}
      className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <span aria-hidden="true">{ICON[current]}</span> {LABEL[current]}
    </button>
  );
}
