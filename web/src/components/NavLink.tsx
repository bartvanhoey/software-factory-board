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
  const base = "whitespace-nowrap text-sm font-medium transition-colors";
  const style =
    variant === "tab"
      ? "border-b-2 border-transparent px-1 pb-2.5 text-muted hover:text-fg aria-[current=page]:border-accent aria-[current=page]:text-fg"
      : "rounded-lg px-3 py-1.5 text-muted hover:bg-subtle hover:text-fg aria-[current=page]:bg-subtle aria-[current=page]:text-fg";
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={`${base} ${style}`}>
      {children}
    </Link>
  );
}
