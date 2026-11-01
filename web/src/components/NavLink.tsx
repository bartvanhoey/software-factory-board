"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** A navigation link that marks itself as the current page. `prefixes` lists extra path prefixes that count as "here". */
export function NavLink({
  href,
  children,
  prefixes = [],
  variant = "nav",
}: {
  href: string;
  children: ReactNode;
  prefixes?: string[];
  variant?: "nav" | "tab";
}) {
  const pathname = usePathname();
  const current = pathname === href || prefixes.some((p) => pathname.startsWith(p));
  // On a touch screen the link is at least 40px tall, however little text it holds.
  const base = "whitespace-nowrap text-sm font-medium transition-colors pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center";
  const style =
    variant === "tab"
      ? "border-b-2 border-transparent px-1 pb-2.5 text-muted hover:text-fg aria-[current=page]:border-accent aria-[current=page]:text-fg"
      : "rounded-lg px-2 py-1.5 text-muted sm:px-3 hover:bg-subtle hover:text-fg aria-[current=page]:bg-subtle aria-[current=page]:text-fg";
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={`${base} ${style}`}>
      {children}
    </Link>
  );
}
