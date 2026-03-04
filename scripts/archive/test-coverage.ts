/**
 * Test: do our broad franchise searches already cover the niche titles?
 * If "マリオ ソフト Switch" returns Luigi's Mansion, Smash Bros, etc. we don't need separate searches.
 */
import { scanMercariTerm } from "@mercari-bot/core";

async function search(term: string, priceMax: number) {
  return scanMercariTerm({
    term,
    filters: { priceMin: null, priceMax, titleMustContain: [], excludeKeyword: null },
    timeoutMs: 15000,
    maxItems: 100,
  });
}

async function main() {
  const DELAY = 800;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Test 1: Does "マリオ ソフト Switch" cover all Mario sub-games?
  console.log("=== Does 'マリオ ソフト Switch' cover sub-franchises? ===");
  const mario = await search("マリオ ソフト Switch", 9000);
  const marioTitles = mario.map((r) => r.title);
  for (const check of ["カート", "パーティ", "オデッセイ", "ワンダー", "3D", "ルイージ", "スマッシュ", "ソニック", "ペーパー"]) {
    const found = marioTitles.filter((t) => t.includes(check));
    console.log(`  ${check}: ${found.length} hits ${found.length > 0 ? `(e.g. ${found[0]?.substring(0, 50)})` : "❌ NOT FOUND"}`);
  }
  await sleep(DELAY);

  // Test 2: Does "ポケットモンスター Switch" cover all Pokemon variants?
  console.log("\n=== Does 'ポケットモンスター Switch' cover Pokemon variants? ===");
  const poke = await search("ポケットモンスター Switch", 18000);
  const pokeTitles = poke.map((r) => r.title);
  for (const check of ["シールド", "ソード", "アルセウス", "ピカチュウ", "イーブイ", "シャイニング", "スカーレット", "バイオレット", "ブリリアント", "スナップ"]) {
    const found = pokeTitles.filter((t) => t.includes(check));
    console.log(`  ${check}: ${found.length} hits ${found.length > 0 ? `(e.g. ${found[0]?.substring(0, 50)})` : "❌ NOT FOUND"}`);
  }
  await sleep(DELAY);

  // Test 3: Does "ゼルダの伝説 Switch" cover all Zelda games?
  console.log("\n=== Does 'ゼルダの伝説 Switch' cover Zelda variants? ===");
  const zelda = await search("ゼルダの伝説 Switch", 7000);
  const zeldaTitles = zelda.map((r) => r.title);
  for (const check of ["ブレス", "ティアーズ", "夢をみる"]) {
    const found = zeldaTitles.filter((t) => t.includes(check));
    console.log(`  ${check}: ${found.length} hits ${found.length > 0 ? `(e.g. ${found[0]?.substring(0, 50)})` : "❌ NOT FOUND"}`);
  }
  await sleep(DELAY);

  // Test 4: Does "星のカービィ Switch" cover all Kirby games?
  console.log("\n=== Does '星のカービィ Switch' cover Kirby variants? ===");
  const kirby = await search("星のカービィ Switch", 6500);
  const kirbyTitles = kirby.map((r) => r.title);
  for (const check of ["ディスカバリー", "スターアライズ", "Wii"]) {
    const found = kirbyTitles.filter((t) => t.includes(check));
    console.log(`  ${check}: ${found.length} hits ${found.length > 0 ? `(e.g. ${found[0]?.substring(0, 50)})` : "❌ NOT FOUND"}`);
  }
  await sleep(DELAY);

  // Test 5: What about a single "Nintendo Switch ソフト" with lower price?
  // Could we just monitor ALL Switch software in one search?
  console.log("\n=== 'Nintendo Switch ソフト' — what games appear? ===");
  const all = await search("Nintendo Switch ソフト", 9000);
  const allTitles = all.map((r) => `${r.title} ¥${r.numericPrice}`);
  console.log(`  ${all.length} results. First 15:`);
  allTitles.slice(0, 15).forEach((t) => console.log(`    ${t}`));
  await sleep(DELAY);

  // Test 6: Noise check — how many results from broad searches are NOT games?
  console.log("\n=== Noise check: 'マリオ ソフト Switch' non-game items ===");
  const gameKeywords = ["ソフト", "ゲーム", "カセット", "パッケージ", "Nintendo", "Switch", "ニンテンドー"];
  const nonGame = mario.filter((r) => !gameKeywords.some((k) => r.title.includes(k)));
  console.log(`  ${nonGame.length}/${mario.length} items don't mention game-related keywords:`);
  nonGame.slice(0, 5).forEach((r) => console.log(`    ${r.title.substring(0, 60)} ¥${r.numericPrice}`));
}

main().catch(console.error);
