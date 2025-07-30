# DPoP Token Reverse-Engineering – Working Summary

## 1. Context / Goal
Mercari’s public web frontend (https://jp.mercari.com) issues unauthenticated search API calls to `https://api.mercari.jp/v2/entities:search` that are protected by a **DPoP** (Demonstration of Proof-of-Possession) header.  Our long-term goal is to replicate this behaviour outside the browser so a custom scraper can:
1. Generate/obtain a valid DPoP token without logging-in.
2. Re-use that token to perform search and item-detail API calls programmatically.

## 2. Work Completed So Far
1. Launched the site with Playwright and executed several searches (e.g. *プレイステーション4*, *Nintendo Switch*).
2. Inspected network traffic – confirmed each API request contains a `DPoP` header.
3. Installed a temporary `fetch` hook inside the browser page to capture the header; the hook did **not** record a token (likely generated in a worker or XHR layer before the hook).
4. Enumerated `<script>` tags and Next.js chunks served from `https://web-jp-assets-v2.mercdn.net/_next/static/…`.
5. Confirmed the application loads ~150 scripts; the crypto/DPoP logic is expected to live inside one of these minified chunks.
6. Recalled typical DPoP creation flow (Web Crypto key-pair → JWT with `htm`, `htu`, `jti`, `iat` → signed & sent as header).

## 3. Key Findings
* The site works without login, so token creation is fully client-side.
* Token is generated **per request** or short session – no login cookies involved.
* Likely implemented with Web Crypto `SubtleCrypto` and a small JWT helper embedded in a Next.js chunk.

## 4. Open Questions / Tasks Ahead
1. **Locate the Generation Code** 
   • Download the highlighted Next.js bundles and grep for `htm`, `htu`, `DPoP`, `crypto.subtle.generateKey`, etc.
2. **Reproduce Key-Pair & JWT** 
   • Identify algorithm (EC P-256 vs. RSA).  
   • Extract public-key params (may be random per page-load).
3. **Implement Generator in Scraper** 
   • Use Node.js `crypto` or Python `cryptography` to match the browser logic.  
   • Build a helper that, given a method+URL, returns a fresh DPoP header.
4. **Validate** 
   • Replay a search request with cURL/Postman using the generated header.  
   • Tweak until the API accepts it (HTTP 200 instead of 403).

## 5. Suggested Next Steps (Minimum Viable)
| Priority | Task | Deliverable |
|----------|------|-------------|
| P0 | Dump selected JS bundles (`framework`, `main`, `pages/_app`) | Local copies for static analysis |
| P0 | Search for Web Crypto & JWT keywords | List of candidate functions |
| P1 | Isolate DPoP builder function | Beautified snippet & call graph |
| P1 | Write standalone Node/Python PoC that generates identical JWT | `generate_dpop.py/js` |
| P2 | Integrate PoC into scraping pipeline | Scraper successfully queries `/v2/entities:search` |
