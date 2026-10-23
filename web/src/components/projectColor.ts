/** Fixed class names so Tailwind can see them. */
const COLORS = [
  { dot: "bg-sky-500", badge: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100" },
  { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" },
  { dot: "bg-violet-500", badge: "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100" },
  { dot: "bg-orange-500", badge: "bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100" },
  { dot: "bg-pink-500", badge: "bg-pink-100 text-pink-900 dark:bg-pink-900 dark:text-pink-100" },
  { dot: "bg-teal-500", badge: "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100" },
  { dot: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100" },
  { dot: "bg-indigo-500", badge: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100" },
] as const;

/** Same project name, same color, on the chip and on every card. */
export function projectColor(name: string): (typeof COLORS)[number] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] as (typeof COLORS)[number];
}
