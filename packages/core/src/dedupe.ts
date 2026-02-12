import crypto from "node:crypto";

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

export function deriveSourceListingId(url: string): string | null {
  const match = url.match(/item\/([a-zA-Z0-9]+)/);
  return match?.[1] ?? null;
}

export function buildDedupeKey(params: {
  sourceListingId: string | null;
  url: string;
  title: string;
  imageUrl: string;
}): string {
  if (params.sourceListingId) {
    return `listing:${params.sourceListingId}`;
  }

  const fingerprint = `${params.url}|${normalizeTitle(params.title)}|${params.imageUrl}`;
  return `hash:${crypto.createHash("sha256").update(fingerprint).digest("hex")}`;
}
