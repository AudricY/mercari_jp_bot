# Plan – Add Comprehensive Codebase Overview under `/docs`

## 1. Purpose & Scope
Create a single, self-contained documentation page that gives newcomers (and future-me) a clear, high-level understanding of how the Mercari Telegram Bot is structured and how its main components interact at runtime.

The document will live at `docs/overview.md` (or `docs/architecture_overview.md`) and will cover:
* Project goals & feature list
* Directory / package layout
* Configuration & runtime parameters
* Core modules (`config`, `main`, `scraper`, `telegram`, `store`, `scheduler`, `utils`, `models`)
* End-to-end execution flow (keyword loop, Selenium scraping, Telegram push, persistence)
* Daily summary job & rate-limiting strategy
* Sequence & architecture diagrams (Mermaid)
* How to extend / customise

No production code will be modified; only Markdown documentation will be added.

---

## 2. Key Files to Create / Modify
| Path | Action | Notes |
|------|--------|-------|
| `docs/overview.md` | **Create** | Main overview document |
| (optional) `docs/diagrams/` | *Create* | If we decide to store Mermaid sources separately |

No existing source files are changed.

---

## 3. Implementation Outline
1. **Gather Facts** – (already done) reviewed all source files in `src/mercari_bot` plus root configs & README.
2. **Draft Document Structure** – Sections outlined above, including TOC.
3. **Author Content** – Summaries for each module, detailed runtime flow, configuration table, etc.
4. **Add Mermaid Flow Diagram** – Simple graph showing interaction between Scheduler → Scraper → Store → Telegram.
5. **Commit/Save** the new Markdown file.
6. **Verification** – Quick manual lint (`markdownlint` if available) & read-through for clarity.

---

## 4. Potential Risks / Trade-offs / Open Questions
* **Duplication with README** – Keep overview higher-level, link to README for setup details.
* **Staleness** – Document can fall out of sync with code; add note encouraging updates on code changes.
* **Diagram Rendering** – Mermaid diagrams render in most modern viewers but may not display on all platforms. Provide code block fallback.

---

## 5. Next Steps
* Wait for user approval of this plan.
* After approval, implement steps above to create the overview document.
