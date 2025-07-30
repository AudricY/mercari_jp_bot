# Plan: Add price range support per keyword

## Purpose & Scope
Enable specifying minimum and/or maximum price (in yen) for every search keyword.  The bot should append `&price_min=…` and/or `&price_max=…` to the Mercari search URL so that only items within the desired price range are returned.

## Summary of Changes
1. **Configuration Layer**
   * Introduce a `KeywordConfig` data-class wrapping:
     * `term` – search term (existing field)
     * `price_min` – optional integer
     * `price_max` – optional integer
   * Update `Settings.keywords` to `dict[str, KeywordConfig]`.
   * Extend `load_settings()` to:
     * Accept both the old *string* style and the new *mapping* style for each keyword (backward-compatible).
     * Convert each entry into a `KeywordConfig` instance.

2. **Scraper Layer** (`scraper.py`)
   * Extend `fetch_items()` signature with `price_min: int | None = None`, `price_max: int | None = None`.
   * Append the parameters to the search URL when present.

3. **Main Loop** (`main.py`)
   * Iterate over `cfg.keywords.items()` where the value is now a `KeywordConfig`.
   * Pass the price range values to `fetch_items()`.

4. **Config File** (`config.yaml`)
   * Demonstrate new structure, e.g.:
     ```yaml
     keywords:
       ps3:
         term: プレイステーション3 (PS3) 本体
         price_min: 1000
         price_max: 3000
       ps4: プレイステーション4 (PS4) 本体   # old style still works
     ```

5. **Testing & Verification**
   * Unit test for `load_settings()` ensuring correct parsing of both styles.
   * Manual run with sample config verifying the generated URL contains the price parameters.
   * Regression check to ensure old-style config still functions.

## Step-by-Step Implementation Outline
1. Create `KeywordConfig` dataclass in `config.py`.
2. Update `Settings.keywords` typing and logic in `load_settings()`.
3. Adjust `main._run()` to use the new structure.
4. Update `scraper.fetch_items()`:
   * Accept the new parameters.
   * Modify URL builder accordingly.
5. Update docstrings & logging messages.
6. Provide sample `config.yaml` changes in repository docs (if applicable).
7. Write/adjust tests.

## Potential Risks / Trade-offs
* Type change to `Settings.keywords` affects downstream code; addressed by keeping backward compatibility and updating all usages.
* Users may have existing configs; backward compatibility ensures no breaking change but documentation update is essential.

---
Please review and approve or request adjustments.