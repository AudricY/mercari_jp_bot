import type { Metadata } from "next";

import { TopNav } from "@/components/TopNav";

export const metadata: Metadata = {
  title: "Mercari Analytics",
  description: "Market intelligence dashboard for Mercari JP Bot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0a0a", color: "#e5e5e5" }}>
        <TopNav />
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
