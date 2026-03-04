/**
 * Test refined search strategies: broad terms + "Switch" in keyword or titleMustContain
 */
import { scanMercariTerm } from "@mercari-bot/core";

interface SearchTest {
  label: string;
  term: string;
  priceMin?: number;
  priceMax?: number;
  titleMustContain?: string[];
  excludeKeyword?: string;
}

const tests: SearchTest[] = [
  // Strategy 1: Add "Switch" to broad search terms
  { label: "ポケットモンスター Switch", term: "ポケットモンスター Switch", priceMax: 8500 },
  { label: "ポケモン Switch ソフト", term: "ポケモン Switch ソフト", priceMax: 8500 },
  { label: "スーパーマリオ Switch ソフト", term: "スーパーマリオ Switch ソフト", priceMax: 8500 },
  { label: "ゼルダの伝説 Switch", term: "ゼルダの伝説 Switch", priceMax: 7000 },
  { label: "星のカービィ Switch", term: "星のカービィ Switch", priceMax: 6500 },

  // Strategy 2: Broad term + titleMustContain filter
  { label: "ポケットモンスター [must:Switch]", term: "ポケットモンスター", priceMax: 8500, titleMustContain: ["Switch"] },
  { label: "スーパーマリオ [must:Switch]", term: "スーパーマリオ", priceMax: 8500, titleMustContain: ["Switch"] },
  { label: "ゼルダの伝説 [must:Switch]", term: "ゼルダの伝説", priceMax: 7000, titleMustContain: ["Switch"] },
  { label: "マリオカート [must:Switch]", term: "マリオカート", priceMax: 5000, titleMustContain: ["Switch"] },
  { label: "マリオパーティ [must:Switch]", term: "マリオパーティ", priceMax: 8000, titleMustContain: ["Switch"] },
  { label: "大乱闘スマッシュブラザーズ [must:Switch]", term: "大乱闘スマッシュブラザーズ", priceMax: 5500, titleMustContain: ["Switch"] },
  { label: "あつまれ どうぶつの森 [must:Switch]", term: "あつまれ どうぶつの森", priceMax: 5500, titleMustContain: ["Switch"] },
  { label: "スプラトゥーン3 [must:Switch]", term: "スプラトゥーン3", priceMax: 4000, titleMustContain: ["Switch"] },

  // Strategy 3: Specific games that need individual searches anyway
  { label: "スニッパーズ [must:Switch]", term: "スニッパーズ", priceMax: 3500, titleMustContain: ["Switch"] },
  { label: "ルイージマンション3 [must:Switch]", term: "ルイージマンション3", priceMax: 4500, titleMustContain: ["Switch"] },
  { label: "ヨッシークラフトワールド", term: "ヨッシークラフトワールド", priceMax: 5000 },
  { label: "Xenoblade3 [must:Switch]", term: "Xenoblade3", priceMax: 3500, titleMustContain: ["Switch"] },
  { label: "ゼノブレイド3 [must:Switch]", term: "ゼノブレイド3", priceMax: 3500, titleMustContain: ["Switch"] },
  { label: "It Takes Two [must:Switch]", term: "It Takes Two", priceMax: 3500, titleMustContain: ["Switch"] },
  { label: "デイヴ・ザ・ダイバー [must:Switch]", term: "デイヴ・ザ・ダイバー", priceMax: 9000, titleMustContain: ["Switch"] },
  { label: "Minecraft [must:Switch]", term: "Minecraft", priceMax: 4000, titleMustContain: ["Switch"] },
  { label: "マインクラフト [must:Switch]", term: "マインクラフト", priceMax: 4000, titleMustContain: ["Switch"] },
  { label: "メイドインワリオ [must:Switch]", term: "超おどる メイドインワリオ", priceMax: 4500 },
  { label: "三國無双7 [must:Switch]", term: "三國無双7 Switch", priceMax: 6000 },
  { label: "Switch Sports [must:Switch]", term: "Nintendo Switch Sports", priceMax: 5000, titleMustContain: ["Sports"] },
  { label: "ピクミン4", term: "ピクミン4", priceMax: 5000 },
  { label: "スターデューバレー", term: "スターデューバレー", priceMax: 5000 },

  // NS2 games
  { label: "ドンキーコング バナンザ", term: "ドンキーコング バナンザ", priceMax: 6000 },
  { label: "マリオカートワールド [must:ソフト]", term: "マリオカートワールド", priceMax: 8500, titleMustContain: ["ソフト"] },
  { label: "マリオカートワールド [no must]", term: "マリオカートワールド ソフト", priceMax: 8500 },
  { label: "HADES II Switch", term: "HADES II", priceMax: 5000, titleMustContain: ["Switch"] },
  { label: "サイバーパンク2077 [must:Switch]", term: "サイバーパンク2077", priceMax: 6500, titleMustContain: ["Switch"] },
];

const DELAY_MS = 800;

async function main() {
  console.log("Testing refined search strategies...\n");
  console.log(`${"Search Term".padEnd(55)} | Count | Sample Titles`);
  console.log("-".repeat(130));

  for (const test of tests) {
    try {
      const results = await scanMercariTerm({
        term: test.term,
        filters: {
          priceMin: test.priceMin ?? null,
          priceMax: test.priceMax ?? null,
          titleMustContain: test.titleMustContain ?? [],
          excludeKeyword: test.excludeKeyword ?? null,
        },
        timeoutMs: 15000,
        maxItems: 100,
      });

      const sampleTitles = results
        .slice(0, 3)
        .map((r) => `${r.title.substring(0, 40)} ¥${r.numericPrice}`)
        .join(" | ");

      console.log(`${test.label.padEnd(55)} | ${String(results.length).padStart(5)} | ${sampleTitles}`);
    } catch (err) {
      console.log(`${test.label.padEnd(55)} | ERROR | ${(err as Error).message.substring(0, 60)}`);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

main().catch(console.error);
