# Plan: Switch Keywords Mapping (Display Name -> Search Term)

## Purpose & Scope
Convert the `keywords` mapping semantics so that **the dict key is the display name shown in Telegram messages** and **the dict value is the search term sent to Mercari**. This requires code changes where keywords are consumed and updating configuration documentation.

## Key Files
1. `config.yaml` – update example & inline docs.
2. `src/mercari_bot/main.py` – iterate over new mapping, adjust logging & messaging.
3. `src/mercari_bot/scheduler.py` – use display name directly without lookup.
4. `src/mercari_bot/config.py` – update docstring/comments to reflect new mapping.
5. (Optional) Any tests or other modules referencing `keywords`.

## Implementation Steps
1. **Update `config.py`**
   * Change comment for `keywords` attribute to `(display_name -> search_term)`.

2. **Refactor `main.py`**
   * Iterate: `for display_name, search_term in cfg.keywords.items():`
   * Pass `search_term` to `fetch_items()`.
   * Use `display_name` for user-facing messages & logging.
   * Store counts keyed by `display_name`.

3. **Refactor `scheduler.py`**
   * Iterate through `daily_counts` and use the key (display name) directly.
   * Remove `keywords_map` lookup or adjust signature accordingly.

4. **Adjust Function Signatures**
   * Update `send_daily_summary` signature to receive `keywords_map` only if still needed; otherwise remove param.
   * Update call site in `main.py` accordingly.

5. **Update `config.yaml`**
   * Swap key/value pairs so key = display name, value = search term.
   * Add YAML comments above the section explaining the mapping.

6. **Testing & Verification**
   * Run bot locally with sample keywords to ensure searches work and messages display correctly.
   * Verify daily summary output.

## Potential Risks & Mitigations
* **Unupdated imports/usage**: Search for `.keywords.` usages to ensure no overlooked references.
* **Backward compatibility**: Existing configs will break; document change clearly in `config.yaml` comments and CHANGELOG.
* **Daily summary signature change**: ensure both call site and function updated.

---

*Please review & approve this plan. No code will be modified until approval.* 