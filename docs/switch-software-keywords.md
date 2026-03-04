# Switch Software Keyword Strategy

Tested 2025-03-05 against Mercari API.

## Approach

Mercari returns max 100 results sorted by newest. "franchise + Switch" in the search term filters out merchandise/plushies effectively. Ultra-broad terms like "Switch ソフト" return random games and miss specific titles.

## Franchise searches (4 terms → ~30 games)

| Search term | Confirmed coverage |
|---|---|
| `ポケットモンスター Switch` | Shield, Sword, Arceus, Let's Go Pikachu/Eevee, Shining Pearl, Brilliant Diamond, Scarlet, Violet, DLC bundles |
| `マリオ ソフト Switch` | Kart 8, Party, Jamboree, Odyssey, Wonder, 3D World, 3D Collection, NSMBU, Mario & Sonic, Paper Mario |
| `ゼルダの伝説 Switch` | BotW, TotK, Link's Awakening |
| `星のカービィ Switch` | Discovery, Star Allies, Wii Deluxe |

## Not covered by franchise searches

These need their own search terms:
- **ポケモンスナップ** — uses "ポケモン" not "ポケットモンスター"
- **大乱闘スマッシュブラザーズ** — no "マリオ" in title
- **ルイージマンション3** — no "マリオ" in title
- All single-franchise games (Animal Crossing, Splatoon, Pikmin, Xenoblade, etc.)

## Filtering notes

- `title_must_contain: ["Switch"]` is too strict — many listings omit "Switch" from the title. Returned 0 for Pokemon.
- Adding "Switch" to the **search term itself** works much better (Mercari does fuzzy matching server-side).
- `price_max` on grouped keywords must be the highest budget in the group. Accepted tradeoff: alerts for cheaper games listed above their individual target.
- `スターデューバレー Switch` returned 0 results; `スターデューバレー` alone returns 19 (mostly merch). Low volume game.
