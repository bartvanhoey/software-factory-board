import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Software Factory Board",
  description: "Monitor issue processing across all factory projects.",
};

// Runs before first paint so the saved/OS theme applies without a flash.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The Content-Security-Policy only runs scripts that carry this request's nonce (set by proxy.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only z-30 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <TopBar />
        {/* Target of the skip link; tabIndex -1 lets it take focus without joining the tab order. */}
        <div id="main" tabIndex={-1} className="mx-auto max-w-[1600px] px-4 py-8 focus:outline-none sm:px-6">
          {children}
        </div>
      </body>
    </html>
  );
}
