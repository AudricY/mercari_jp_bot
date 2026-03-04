/**
 * Test ultra-broad search strategies — can we get away with just a few searches?
 */
import { scanMercariTerm } from "@mercari-bot/core";

interface SearchTest {
  label: string;
  term: string;
  priceMin?: number;
  priceMax?: number;
  titleMustContain?: string[];
}

const tests: SearchTest[] = [
  // Can we just search "Switch ソフト" with price bounds?
  { label: "Switch ソフト (all switch software)", term: "Switch ソフト", priceMax: 9000 },
  { label: "Switch ソフト ¥2000-5000", term: "Switch ソフト", priceMin: 2000, priceMax: 5000 },
  { label: "Switch ソフト ¥5000-9000", term: "Switch ソフト", priceMin: 5000, priceMax: 9000 },
  { label: "Nintendo Switch ゲーム", term: "Nintendo Switch ゲーム", priceMax: 9000 },

  // Category-style: "Switch2 ソフト" for NS2
  { label: "Switch2 ソフト (all NS2)", term: "Switch2 ソフト", priceMax: 9000 },
  { label: "Nintendo Switch 2 ソフト", term: "Nintendo Switch 2 ソフト", priceMax: 9000 },

  // Broader franchise + ソフト
  { label: "ポケモン ソフト", term: "ポケモン ソフト", priceMax: 8500 },
  { label: "マリオ ソフト Switch", term: "マリオ ソフト Switch", priceMax: 8500 },

  // What about just using the Japanese game names directly (no "Switch")?
  // These are specific enough that they shouldn't need filtering
  { label: "ポケットモンスター (no filter)", term: "ポケットモンスター", priceMin: 1500, priceMax: 8500 },
  { label: "ゼルダの伝説 (no filter, price bound)", term: "ゼルダの伝説", priceMin: 2000, priceMax: 7000 },
  { label: "スーパーマリオ (no filter, price bound)", term: "スーパーマリオ", priceMin: 2000, priceMax: 8500 },
];

const DELAY_MS = 800;

async function main() {
  console.log("Testing ultra-broad search strategies...\n");
  console.log(`${"Search".padEnd(50)} | Count | Sample Titles (first 5)`);
  console.log("-".repeat(140));

  for (const test of tests) {
    try {
      const results = await scanMercariTerm({
        term: test.term,
        filters: {
          priceMin: test.priceMin ?? null,
          priceMax: test.priceMax ?? null,
          titleMustContain: test.titleMustContain ?? [],
          excludeKeyword: null,
        },
        timeoutMs: 15000,
        maxItems: 100,
      });

      const sampleTitles = results
        .slice(0, 5)
        .map((r) => `${r.title.substring(0, 35)} ¥${r.numericPrice}`)
        .join(" | ");

      console.log(`${test.label.padEnd(50)} | ${String(results.length).padStart(5)} | ${sampleTitles}`);
    } catch (err) {
      console.log(`${test.label.padEnd(50)} | ERROR | ${(err as Error).message.substring(0, 60)}`);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

main().catch(console.error);
