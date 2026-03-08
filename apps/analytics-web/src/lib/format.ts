export function formatPrice(price: number, currency = "JPY"): string {
  if (currency === "JPY") return `¥${price.toLocaleString("ja-JP")}`;
  return `${price.toLocaleString()} ${currency}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
