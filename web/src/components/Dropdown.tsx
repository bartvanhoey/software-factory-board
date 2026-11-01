"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/** A <details> menu that closes on outside click, Escape and navigation. Works as a plain disclosure without JS. */
export function Dropdown({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={label}
        className="flex size-9 cursor-pointer list-none pointer-coarse:size-10 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-soft-fg transition-shadow hover:ring-2 hover:ring-line-strong [&::-webkit-details-marker]:hidden"
      >
        {trigger}
      </summary>
      {/* On a touch screen every link and button in the menu is at least 40px tall. */}
      <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg pointer-coarse:[&_a]:flex pointer-coarse:[&_a]:min-h-10 pointer-coarse:[&_a]:items-center pointer-coarse:[&_button]:flex pointer-coarse:[&_button]:min-h-10 pointer-coarse:[&_button]:items-center">
        {children}
      </div>
    </details>
  );
}
