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
        <TopBar />
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">{children}</div>
      </body>
    </html>
  );
}
