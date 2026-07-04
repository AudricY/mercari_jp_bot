import type { ArbitrageFeeModel, ArbitrageFx } from "@/lib/api";
import { formatPct, formatPrice, formatRelativeTime, formatUsd } from "@/lib/format";

export function FxFeeNote({
  fx,
  feeModel,
  generatedAt,
}: {
  fx: ArbitrageFx;
  feeModel: ArbitrageFeeModel;
  generatedAt: string;
}) {
  const intl = Object.entries(feeModel.intlShippingUsdByClass)
    .map(([cls, usd]) => `${cls.replace(/_/g, " ")} ${formatUsd(usd)}`)
    .join(" / ");
  return (
    <p style={{ color: "#737373", fontSize: 13, margin: "0 0 24px" }}>
      FX &yen;{fx.jpyPerUsd.toLocaleString("en-US")}/USD ({fx.source}, {formatRelativeTime(fx.fetchedAt)}) &middot; eBay fees{" "}
      {formatPct(feeModel.ebayFinalValueFeePct)} + {formatUsd(feeModel.ebayFixedFeeUsd)} + {formatPct(feeModel.ebayAdRatePct)} ads
      &middot; proxy {formatPrice(feeModel.proxyFeeJpy)}
      {feeModel.proxyFeePct > 0 ? ` + ${formatPct(feeModel.proxyFeePct)}` : ""} &middot; JP shipping{" "}
      {formatPrice(feeModel.jpDomesticShippingJpy)} &middot; intl shipping {intl} &middot; target ROI{" "}
      {formatPct(feeModel.targetRoiPct)} &middot; computed {formatRelativeTime(generatedAt)}
    </p>
  );
}
