# Plan – Telegram Rate-Limit Handling

## Purpose & Scope
The bot occasionally hits Telegram HTTP 429 (Too Many Requests) when it sends many
`sendPhoto` / `sendMessage` calls back-to-back.  The goal is to prevent these
errors by introducing built-in rate-limiting and retry/back-off logic while
keeping configuration flexible.

## Key Changes
1. **Config (`src/mercari_bot/config.py`, `config.yaml`)
   • Add `telegram_min_delay` (float, seconds, default **1.2 s**) – minimum time
     between any two Telegram API calls for this bot.
   • (Optional) future-proof: `telegram_max_retries` & `telegram_backoff`.

2. **Telegram Helper (`src/mercari_bot/telegram.py`)
   • Introduce `_rate_limited_post(cfg, endpoint, payload, timeout)` that:
     a. Enforces `telegram_min_delay` (global per-process) using the timestamp of
        the previous successful/attempted request.
     b. Catches HTTP 429, reads `Retry-After` header when present, waits
        (`max(retry_after, cfg.telegram_min_delay)`) and retries (up to 3 times,
        exponential back-off  2×, 4× …).
   • Update `send_message` & `send_photo` to use this new helper instead of the
     raw `_post` function.

3. **Main Loop Touch-up (`src/mercari_bot/main.py`)
   • No functional change needed; calls already go through helper. Keep existing
     `keyword_batch_delay` & `full_cycle_delay` untouched.

4. **Tests (optional but recommended)**
   • Unit-test `_rate_limited_post` with mocked `requests.post` returning 429 and
     verifying retries & sleep intervals.

## Implementation Steps
1. **Config Update**
   - Extend `Settings` dataclass with `telegram_min_delay: float = 1.2`.
   - In `load_settings()`, read `delays["telegram_min_delay"]`, falling back to
     default 1.2.

2. **Telegram Helper**
   - Add module-level variable `_LAST_REQUEST_TS: float = 0.0` and
     `threading.Lock()` for safety.
   - Implement `_rate_limited_post` logic (delay + retry).
   - Replace calls in `send_message` / `send_photo`.
   - Keep existing `_post` as low-level raw sender (used internally only).

3. **Documentation**
   - Update example `config.yaml` comment to illustrate new setting.

## Verification
1. Run the bot with a low `telegram_min_delay` (e.g. 0.3 s) and a high number of
   dummy items to ensure:
   • No 429s are raised.
   • Delay is respected (check timestamps in logs).
2. Unit tests pass.
3. Manual end-to-end test in staging chat.

## Risks & Trade-offs
• Too aggressive delay could slow down message delivery; default 1.2 s balances
  safety & speed.
• Retry loop could still fail if bot is flood-limited for a long period; after
  3 retries we will re-raise so the error can be logged and handled upstream.

## Open Questions
1. Should `telegram_min_delay` be keyword-specific (per-chat) or global?  Current
   plan treats it as global which suffices for single-chat usage.
2. Do we want configurable `max_retries` & `backoff_factor` now or later?

---
*Please review the plan.  No code will be modified until you approve.*
