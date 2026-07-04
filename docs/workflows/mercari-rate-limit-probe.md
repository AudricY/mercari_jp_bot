# Mercari Rate-Limit Probe

Use `scripts/mercari-rate-probe.ts` to estimate the current safe search-request ceiling for the VPS IP.

For API *capability* probing (sold search, pagination, category tree, filters) use `pnpm run probe:mercari-capabilities` instead — findings are recorded in `docs/mercari-scrape-intelligence.md`.

This is an empirical probe, not a contract from Mercari. Run it during a maintenance window because the app scheduler should be stopped to avoid contaminating the result.

## Command

```bash
docker compose stop app
pnpm run probe:mercari-rate -- --duration-sec 90 --delays-ms 2000,1500,1250,1000,850,700,600,500 --page-size 100
docker compose start app
```

The probe stops at the first `429` by default and waits through a cooldown before exiting.

## 2026-06-28 VPS Result

Probe target:

- Host/IP: Oracle VPS production host
- Term: `ゼルダの伝説 Switch`
- Category: `702`
- `pageSize`: `100`
- Phase duration: `90s`

Results:

| Delay | Estimated RPM | Attempts | 200 | 429 | p50 | p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 2000ms | 30.0 | 45 | 45 | 0 | 245ms | 282ms |
| 1500ms | 40.0 | 60 | 60 | 0 | 243ms | 293ms |
| 1250ms | 48.0 | 72 | 72 | 0 | 238ms | 276ms |
| 1000ms | 60.0 | 91 | 91 | 0 | 244ms | 285ms |
| 850ms | 76.3 | 13 | 12 | 1 | 256ms | 272ms |

Conclusion:

- Fastest clean observed phase: `1000ms`, about `60 search requests/minute`.
- First rate-limited phase: `850ms`, about `76 search requests/minute`, 429 at request 13.
- Production should not run at the edge. Use `SCRAPE_SEARCH_MIN_DELAY_MS=1250`, about `48 search requests/minute`, as the current safety-margin setting.
- After setting production to `1250ms`, the first restart saw one immediate 429 shortly after the intentional probe failure. The next 5-minute sample was clean: 15 completed scans, 94 successful search requests since restart, and no additional 429s/cooldowns.

Raw output was saved on the VPS at:

```text
/tmp/mercari-rate-probe-20260628132525.log
```
