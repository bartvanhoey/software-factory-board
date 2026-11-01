/** Fixed class names so Tailwind can see them. Cards are neutral with a colored left edge; the badge is a soft tint of the same color. */
const COLORS = [
  { dot: "bg-sky-500", badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", card: "border-l-sky-500" },
  { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", card: "border-l-emerald-500" },
  { dot: "bg-violet-500", badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", card: "border-l-violet-500" },
  { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", card: "border-l-orange-500" },
  { dot: "bg-pink-500", badge: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300", card: "border-l-pink-500" },
  { dot: "bg-teal-500", badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300", card: "border-l-teal-500" },
  { dot: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300", card: "border-l-yellow-500" },
  { dot: "bg-indigo-500", badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", card: "border-l-indigo-500" },
] as const;

/** Same project name, same color, on the chip and on every card. */
export function projectColor(name: string): (typeof COLORS)[number] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] as (typeof COLORS)[number];
}
