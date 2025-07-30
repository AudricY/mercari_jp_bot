# Plan: Title Filter Per Keyword

## Purpose & Scope
Allow each search keyword in `config.yaml` to define an optional `title_must_contain` filter.  
When present, the bot only forwards Mercari listings whose title contains the specified term(s), ensuring higher precision and reducing noise.

## Files / Modules to Modify
1. `src/mercari_bot/config.py`
   * Extend `KeywordConfig` dataclass with a `title_must_contain` field.
   * Parse the new YAML attribute while loading settings.
2. `src/mercari_bot/scraper.py`
   * Update `fetch_items()` signature to accept `title_must_contain` (str | list[str] | None).
   * Add filtering logic before an item is considered **new**.
3. `src/mercari_bot/main.py`
   * Pass `kw_cfg.title_must_contain` to `fetch_items()`.
4. `config.yaml`
   * Document/example usage (no code change required by the bot, but the file format changes).
5. (Optional) Tests – if a test suite exists, add cases covering the new filter logic.

## Implementation Outline
1. **Dataclass Update**
   ```python
   @dataclass(slots=True)
   class KeywordConfig:
       term: str
       price_min: int | None = None
       price_max: int | None = None
       title_must_contain: str | list[str] | None = None  # NEW
   ```

2. **Settings Loader**
   * While iterating over each keyword in `_load_settings`, read `spec.get("title_must_contain")` and pass it to `KeywordConfig`.

3. **Scraper Logic**
   * Accept the additional argument.
   * Normalize to a list of lowercase strings.
   * Skip an item if its lowercase title does **not** contain **any** of the required substrings.
   * Keep search-term behaviour unchanged if the filter is *None*.

4. **Main Loop**
   * Change the call:
     ```python
     items = fetch_items(
         kw_cfg.term,
         seen_items,
         driver,
         kw_cfg.price_min,
         kw_cfg.price_max,
         cfg.max_items_per_scrape,
         kw_cfg.title_must_contain,
     )
     ```

5. **Backward Compatibility**
   * The new field is optional → existing configs continue to work.

6. **Verification & Manual Test**
   * Run the bot with a keyword entry containing the new filter and ensure only titles with the substring are sent.

## Risks / Trade-offs / Open Questions
* **Case sensitivity** – plan: compare in lowercase.
* **Exact vs partial match** – using substring match; if stricter matching is desired, refine later.
* **Multiple terms** – treat a list as logical **OR** (any term is enough). Could later support AND if required.
* **Search performance** – negligible impact due to simple string operations.

---
Please review the plan. Once approved, I will implement these changes.
