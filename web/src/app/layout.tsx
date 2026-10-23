import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Software Factory Board",
  description: "Monitor issue processing across all factory projects.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</div>
      </body>
    </html>
  );
}
