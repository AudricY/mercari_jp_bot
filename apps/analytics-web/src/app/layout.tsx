import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mercari Analytics",
  description: "Market intelligence dashboard for Mercari JP Bot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0a0a", color: "#e5e5e5" }}>
        <header style={{ borderBottom: "1px solid #262626", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <a href="/" style={{ color: "#e5e5e5", textDecoration: "none", fontWeight: 600, fontSize: 18 }}>
            Mercari Analytics
          </a>
        </header>
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
