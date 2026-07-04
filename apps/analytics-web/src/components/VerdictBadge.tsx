import type { ArbitrageVerdict } from "@/lib/api";

const VERDICT_LABELS: Record<ArbitrageVerdict, string> = {
  buy: "Buy",
  watch: "Watch",
  skip: "Skip",
  no_data: "No data",
};

// buy=green, watch=amber, skip=muted, no_data=gray. Chosen for contrast on
// the #0f0f0f surface, consistent with lib/market-colors.ts conventions.
const VERDICT_COLORS: Record<ArbitrageVerdict, string> = {
  buy: "#4ade80",
  watch: "#fbbf24",
  skip: "#737373",
  no_data: "#525252",
};

export function VerdictBadge({ verdict }: { verdict: ArbitrageVerdict }) {
  const color = VERDICT_COLORS[verdict] ?? "#737373";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {VERDICT_LABELS[verdict] ?? verdict}
    </span>
  );
}
