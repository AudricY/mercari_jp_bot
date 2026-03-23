import type { Metadata } from "next";

import { getAnalyticsSessionState } from "../lib/auth";

export const metadata: Metadata = {
  title: "Mercari Analytics",
  description: "Market intelligence dashboard for Mercari JP Bot",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sessionState = await getAnalyticsSessionState();
  const navLinkStyle: React.CSSProperties = {
    color: "#a3a3a3",
    textDecoration: "none",
    fontSize: 14,
  };

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0a0a", color: "#e5e5e5" }}>
        <header style={{ borderBottom: "1px solid #262626", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a href="/" style={{ color: "#e5e5e5", textDecoration: "none", fontWeight: 600, fontSize: 18 }}>
              Mercari Analytics
            </a>
            {sessionState.isAuthenticated && (
              <>
                <a href="/" style={navLinkStyle}>Items</a>
                <a href="/keywords" style={navLinkStyle}>Keywords</a>
              </>
            )}
            {sessionState.isAuthenticated && sessionState.username && (
              <span style={{ color: "#a3a3a3", fontSize: 14 }}>Signed in as {sessionState.username}</span>
            )}
          </div>
          {sessionState.isAuthenticated && (
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #404040",
                  background: "#141414",
                  color: "#e5e5e5",
                  cursor: "pointer",
                }}
              >
                Sign Out
              </button>
            </form>
          )}
        </header>
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
