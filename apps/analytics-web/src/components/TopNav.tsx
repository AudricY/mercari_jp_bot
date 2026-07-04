import Link from "next/link";

import { getAnalyticsSessionState } from "@/lib/auth";

const NAV_LINKS = [
  { href: "/market", label: "Market" },
  { href: "/", label: "Items" },
  { href: "/keywords", label: "Keywords" },
  { href: "/market/search", label: "Search" },
];

const navLinkStyle: React.CSSProperties = {
  color: "#a3a3a3",
  textDecoration: "none",
  fontSize: 14,
  padding: "6px 10px",
  borderRadius: 6,
};

export async function TopNav() {
  const sessionState = await getAnalyticsSessionState();

  return (
    <header
      style={{
        borderBottom: "1px solid #262626",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        background: "#0f0f0f",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/market" style={{ color: "#e5e5e5", textDecoration: "none", fontWeight: 600, fontSize: 18, marginRight: 8 }}>
          Mercari Analytics
        </Link>
        {sessionState.isAuthenticated && (
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} style={navLinkStyle}>
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {sessionState.isAuthenticated && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {sessionState.username && (
            <span style={{ color: "#737373", fontSize: 13 }}>Signed in as {sessionState.username}</span>
          )}
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #404040",
                background: "#141414",
                color: "#e5e5e5",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Sign Out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
