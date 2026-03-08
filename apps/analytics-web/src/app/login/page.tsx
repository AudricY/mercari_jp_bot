import { redirect } from "next/navigation";

import { getLoginDestination } from "../../lib/auth";
import { getAnalyticsSessionState } from "../../lib/auth";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [{ error, next }, sessionState] = await Promise.all([searchParams, getAnalyticsSessionState()]);

  if (!sessionState.configured) {
    return (
      <div style={{ maxWidth: 420, margin: "64px auto", padding: 24, border: "1px solid #262626", borderRadius: 12, background: "#111111" }}>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>Analytics auth is not configured</h1>
        <p style={{ color: "#a3a3a3", lineHeight: 1.5, marginBottom: 0 }}>
          Set <code>ANALYTICS_AUTH_USER</code>, <code>ANALYTICS_AUTH_PASSWORD</code>, and <code>ANALYTICS_SESSION_PASSWORD</code>.
        </p>
      </div>
    );
  }

  if (sessionState.isAuthenticated) {
    redirect(getLoginDestination(next));
  }

  return (
    <div style={{ maxWidth: 420, margin: "64px auto", padding: 24, border: "1px solid #262626", borderRadius: 12, background: "#111111" }}>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 8 }}>Analytics Sign In</h1>
      <p style={{ color: "#a3a3a3", lineHeight: 1.5, marginBottom: 24 }}>
        Sign in to access the Mercari analytics dashboard.
      </p>
      <form action="/auth/login" method="post" style={{ display: "grid", gap: 16 }}>
        <input type="hidden" name="next" value={getLoginDestination(next)} />
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontSize: 14, color: "#d4d4d4" }}>Username</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            required
            style={inputStyle}
          />
        </label>
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontSize: 14, color: "#d4d4d4" }}>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={inputStyle}
          />
        </label>
        {error === "invalid" && (
          <p style={{ margin: 0, color: "#fca5a5", fontSize: 14 }}>
            Invalid username or password.
          </p>
        )}
        <button type="submit" style={buttonStyle}>
          Sign In
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #404040",
  background: "#0a0a0a",
  color: "#e5e5e5",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  fontWeight: 600,
  cursor: "pointer",
};
