/** Fixed class names so Tailwind can see them. The badge is one shade stronger than the card it sits on. */
const COLORS = [
  { dot: "bg-sky-500", badge: "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100", card: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950" },
  { dot: "bg-emerald-500", badge: "bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100", card: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950" },
  { dot: "bg-violet-500", badge: "bg-violet-200 text-violet-900 dark:bg-violet-800 dark:text-violet-100", card: "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950" },
  { dot: "bg-orange-500", badge: "bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100", card: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950" },
  { dot: "bg-pink-500", badge: "bg-pink-200 text-pink-900 dark:bg-pink-800 dark:text-pink-100", card: "border-pink-200 bg-pink-50 dark:border-pink-900 dark:bg-pink-950" },
  { dot: "bg-teal-500", badge: "bg-teal-200 text-teal-900 dark:bg-teal-800 dark:text-teal-100", card: "border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950" },
  { dot: "bg-yellow-500", badge: "bg-yellow-200 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-100", card: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950" },
  { dot: "bg-indigo-500", badge: "bg-indigo-200 text-indigo-900 dark:bg-indigo-800 dark:text-indigo-100", card: "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950" },
] as const;

/** Same project name, same color, on the chip and on every card. */
export function projectColor(name: string): (typeof COLORS)[number] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] as (typeof COLORS)[number];
}
