/**
 * Quick script to test Mercari search terms and see result counts.
 * Usage: npx tsx scripts/test-search-terms.ts
 */
import { scanMercariTerm } from "@mercari-bot/core";

interface SearchTest {
  label: string;
  term: string;
  priceMax?: number;
}

const tests: SearchTest[] = [
  // === BROAD franchise searches ===
  { label: "ポケットモンスター (all Pokemon)", term: "ポケットモンスター", priceMax: 8500 },
  { label: "ポケモン (Pokemon shorthand)", term: "ポケモン", priceMax: 8500 },
  { label: "スーパーマリオ (Super Mario)", term: "スーパーマリオ", priceMax: 8500 },
  { label: "マリオ (all Mario)", term: "マリオ", priceMax: 8500 },
  { label: "ゼルダの伝説 (all Zelda)", term: "ゼルダの伝説", priceMax: 7000 },
  { label: "星のカービィ (all Kirby)", term: "星のカービィ", priceMax: 6500 },
  { label: "Minecraft Switch", term: "Minecraft Switch", priceMax: 4000 },

  // === Medium specificity ===
  { label: "マリオカート (Mario Kart)", term: "マリオカート", priceMax: 5000 },
  { label: "マリオパーティ (Mario Party)", term: "マリオパーティ", priceMax: 8000 },
  { label: "スプラトゥーン3", term: "スプラトゥーン3", priceMax: 4000 },

  // === Individual unique games ===
  { label: "あつまれ どうぶつの森", term: "あつまれ どうぶつの森", priceMax: 5500 },
  { label: "ルイージマンション3", term: "ルイージマンション3", priceMax: 4500 },
  { label: "大乱闘スマッシュブラザーズ SPECIAL", term: "大乱闘スマッシュブラザーズ", priceMax: 5500 },
  { label: "It Takes Two Switch", term: "It Takes Two Switch", priceMax: 3500 },
  { label: "Pikmin 4", term: "Pikmin 4", priceMax: 5000 },
  { label: "ピクミン4", term: "ピクミン4", priceMax: 5000 },
  { label: "Xenoblade3", term: "Xenoblade3", priceMax: 3500 },
  { label: "ゼノブレイド3", term: "ゼノブレイド3", priceMax: 3500 },
  { label: "Switch Sports", term: "Switch Sports", priceMax: 5000 },
  { label: "Nintendo Switch Sports", term: "Nintendo Switch Sports", priceMax: 5000 },
  { label: "スニッパーズ (Snipperclips)", term: "スニッパーズ", priceMax: 3500 },
  { label: "ヨッシークラフトワールド", term: "ヨッシークラフトワールド", priceMax: 5000 },
  { label: "スターデューバレー Switch", term: "スターデューバレー Switch", priceMax: 4000 },
  { label: "三國無双7 (Dynasty Warriors)", term: "三國無双7 Switch", priceMax: 6000 },
  { label: "メイドインワリオ (WarioWare)", term: "メイドインワリオ Switch", priceMax: 4500 },
  { label: "デイヴ・ザ・ダイバー", term: "デイヴ・ザ・ダイバー Switch", priceMax: 9000 },
  { label: "ドンキーコング Switch", term: "ドンキーコング Switch", priceMax: 6000 },
  { label: "マインクラフト ストーリーモード", term: "マインクラフト ストーリーモード", priceMax: 3500 },
  { label: "New スーパーマリオブラザーズ", term: "New スーパーマリオブラザーズ", priceMax: 4000 },

  // === NS2 (Nintendo Switch 2) titles ===
  { label: "Nintendo Switch 2 (all NS2)", term: "Nintendo Switch 2", priceMax: 9000 },
  { label: "Switch 2 Edition", term: "Switch 2 Edition", priceMax: 9000 },
  { label: "マリオカートワールド", term: "マリオカートワールド", priceMax: 8500 },
  { label: "HADES II Switch", term: "HADES II Switch", priceMax: 5000 },
  { label: "サイバーパンク2077 Switch", term: "サイバーパンク2077 Switch", priceMax: 6500 },
];

const DELAY_MS = 800;

async function main() {
  console.log("Testing Mercari search terms...\n");
  console.log("%-50s | %6s | %s", "Search Term", "Count", "Sample Titles");
  console.log("-".repeat(120));

  for (const test of tests) {
    try {
      const results = await scanMercariTerm({
        term: test.term,
        filters: {
          priceMin: null,
          priceMax: test.priceMax ?? null,
          titleMustContain: [],
          excludeKeyword: null,
        },
        timeoutMs: 15000,
        maxItems: 100,
      });

      const sampleTitles = results
        .slice(0, 3)
        .map((r) => `${r.title.substring(0, 35)} ¥${r.numericPrice}`)
        .join(" | ");

      console.log("%-50s | %6d | %s", test.label, results.length, sampleTitles);
    } catch (err) {
      console.log("%-50s | %6s | %s", test.label, "ERROR", (err as Error).message.substring(0, 60));
    }

    // Be nice to the API
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

main().catch(console.error);
