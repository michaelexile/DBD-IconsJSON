// dbd-wiki-sync.ts
// Nightly sync for the DBD icon JSONs. Run: bun run scripts/dbd-wiki-sync.ts [--dry-run]
//
// Names and folders come from NightLight's icon changelog
// (https://docs.nightlight.gg/icon-packs/icon-changelog/). The wiki is only
// used for rarities. The JSON layout never changes.
// A failed fetch fails the whole run so the Action goes red instead of green.

const WIKI_API = "https://deadbydaylight.wiki.gg/api.php";
const PACK_API = "https://nightlight.gg/api/v1/packs/284439124813811712";
const CHANGELOG_URL = "https://docs.nightlight.gg/icon-packs/icon-changelog/";
const STATE_PATH = ".sync-state.json";

const FILES = [
  { file: "dbdItemAddons.json", rarities: ["Common", "Uncommon", "Rare", "Very_Rare", "Visceral", "Event"], pathPrefix: "itemaddons/" },
  { file: "dbdItems.json", rarities: ["Common", "Uncommon", "Rare", "Very_Rare", "Event"], pathPrefix: "items/" },
  { file: "dbdOfferings.json", rarities: ["Common", "Uncommon", "Rare", "Very_Rare", "Visceral", "Event"], pathPrefix: "favors/" },
];

type Entry = { name: string; details: { folder: string; rarity: string } };

const stats: Record<string, number> = {};
function bump(k: string, n = 1) { stats[k] = (stats[k] ?? 0) + n; }

// Match on the icon's own name: strip the game/wiki prefixes and the type
// word, so T_UI_iconAddon_BloodyBoa.png, icons_Addon_BloodyBoa.png and
// iconAddon_BloodyBoa.png all match as "bloodyboa".
export function equiv(name: string): string {
  let s = name.trim().toLowerCase().replace(/\.png$/, "");
  s = s.replace(/^t_ui_/, "");
  s = s.replace(/^icons?_?/, "");
  s = s.replace(/^(addon|item|favor|perk)s?_?/, "");
  return s;
}
export function normRarity(r: string): string {
  // "Very Rare" -> "very_rare". ultra_rare was an old local label, now visceral.
  return r.trim().toLowerCase().replace(/\s+/g, "_");
}

async function fetchJson(url: string, label: string): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "DBD-IconsJSON-sync/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw new Error(`${label} failed after 3 attempts: ${err}`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("unreachable");
}

async function fetchText(url: string, label: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "DBD-IconsJSON-sync/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw new Error(`${label} failed after 3 attempts: ${err}`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("unreachable");
}

// ---- Wiki: category members with page images, paginated ----
async function wikiCategory(rarity: string, type: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  let cont: string | undefined;
  for (let page = 0; page < 20; page++) {
    const p = new URLSearchParams({
      action: "query", format: "json",
      generator: "categorymembers",
      gcmtitle: `Category:${rarity}_${type}`,
      gcmlimit: "max",
      prop: "pageimages", piprop: "name",
      origin: "*",
    });
    if (cont) p.set("gcmcontinue", cont);
    const data = await fetchJson(`${WIKI_API}?${p}`, `wiki Category:${rarity}_${type}`);
    const pages = data?.query?.pages ?? {};
    for (const id of Object.keys(pages)) {
      const pg = pages[id];
      if (pg.title && pg.pageimage) out.push([pg.title, pg.pageimage]);
    }
    cont = data?.continue?.gcmcontinue;
    if (!cont) break;
  }
  return out;
}

// NightLight changelog parsing.
// Per game version: added icons ("<path>.png <Rarity>") and rarity changes
// ("<path>.png <New> (was <Old>)"). Strict patterns; lines that don't parse
// are skipped.
const KNOWN_RARITIES = ["very rare", "ultra rare", "common", "uncommon", "rare", "visceral", "event"];
const SYNCED_SECTIONS = ["addons", "items", "favors", "offerings"];

type ChangelogEntry = { path: string; rarity: string };
type RarityChange = { path: string; from: string; to: string };

function rarityAtEnd(s: string): string | null {
  const low = s.toLowerCase().replace(/\*\*/g, "").trim();
  for (const r of KNOWN_RARITIES) {
    if (low === r || low.endsWith(" " + r)) return r;
  }
  return null;
}

export function parseChangelog(html: string): { added: ChangelogEntry[]; changed: RarityChange[] } {
  // Block tags become line breaks; inline tags vanish. This keeps
  // "<li><a>path.png</a> <strong>Visceral</strong></li>" on one line.
  const text = html
    .replace(/<\/(li|ul|ol|h1|h2|h3|h4|h5|h6|p|div|br|tr|table|section|article|header)>/gi, "\n")
    .replace(/<(li|ul|ol|h1|h2|h3|h4|h5|h6|p|div|br|tr|table|section|article|header)(\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const added: ChangelogEntry[] = [];
  const changed: RarityChange[] = [];
  let inSection = false;

  for (const line of lines) {
    const low = line.toLowerCase();
    if (low === "add-on rarity changes") { inSection = true; continue; }
    if (SYNCED_SECTIONS.includes(low)) { inSection = true; continue; }
    // Any other standalone single-word header ends our section.
    if (/^[a-z /]+$/.test(low) && low.length < 30 && !low.includes(".png")) { inSection = false; continue; }
    if (!inSection) continue;

    const m = line.match(/^(?:-\s*)?(\S+?\.png)\b\s*(.*)$/i);
    if (!m) continue;
    const path = m[1];
    const rest = m[2].trim();
    if (!path.includes("/")) continue; // only full game paths; skip bare names

    const wasM = rest.match(/\(was\s+([^)]+)\)/i);
    if (wasM) {
      const to = rarityAtEnd(rest.replace(wasM[0], ""));
      const from = rarityAtEnd(wasM[1]);
      if (to && from) changed.push({ path, from: normRarity(from), to: normRarity(to) });
      else { bump("changelog_unparseable"); console.log(`  skip (unparseable change): ${line.slice(0, 100)}`); }
      continue;
    }
    const r = rarityAtEnd(rest);
    if (r) added.push({ path, rarity: normRarity(r) });
    else bump("changelog_no_rarity");
  }
  return { added, changed };
}

export function splitPath(path: string): { folder: string; name: string } {
  const i = path.lastIndexOf("/");
  return { folder: path.slice(0, i + 1), name: path.slice(i + 1) };
}

// Nightly sync. The wiki refreshes rarities every run; when the pack
// version changes, the changelog adds new icons and applies rarity changes.
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("DRY RUN - no files will be written.\n");

  const db: Record<string, Entry[]> = {};
  const original: Record<string, string> = {};
  for (const f of FILES) {
    const raw = await Bun.file(f.file).text().catch(() => { throw new Error(`cannot read ${f.file}`); });
    original[f.file] = JSON.stringify(JSON.parse(raw));
    db[f.file] = JSON.parse(raw);
  }
  const state = await Bun.file(STATE_PATH).json().catch(() => ({}));

  // ---- Pack version check (API only; the ZIP can't be downloaded from Actions). ----
  const pack: any = await fetchJson(PACK_API, "NightLight pack API");
  const packData = pack?.data?.pack ?? {};
  const curVersion = String(packData.current_version ?? packData.updated_at ?? "unknown");
  const packChanged = !state.nightlight_version || state.nightlight_version !== curVersion;
  console.log(`NightLight pack version: ${curVersion}${packChanged ? " (changed)" : " (unchanged)"}`);

  // ---- Wiki: the source of rarities. ----
  for (const f of FILES) {
    const type = f.file === "dbdItemAddons.json" ? "Add-ons" : f.file === "dbdItems.json" ? "Items" : "Offerings";
    const wikiRarity = new Map<string, string>();
    for (const rarity of f.rarities) {
      let pages: Array<[string, string]>;
      try {
        pages = await wikiCategory(rarity, type);
      } catch (err) {
        throw new Error(`wiki sync failed for ${f.file}, aborting run: ${err}`);
      }
      for (const [, img] of pages) {
        const k = equiv(img);
        const r = normRarity(rarity);
        if (wikiRarity.has(k) && wikiRarity.get(k) !== r && wikiRarity.get(k) !== "CONFLICT") {
          wikiRarity.set(k, "CONFLICT"); // wiki contradicts itself: trust neither
        } else if (!wikiRarity.has(k)) {
          wikiRarity.set(k, r);
        }
      }
    }
    for (const e of db[f.file]) {
      const w = wikiRarity.get(equiv(e.name));
      if (w === undefined || w === "CONFLICT") continue;
      if (w !== e.details.rarity) {
        e.details.rarity = w;
        bump("wiki_rarity");
      }
    }
  }

  // ---- Changelog: new icons and the check on rarities. ----
  if (packChanged) {
    const html = await fetchText(CHANGELOG_URL, "NightLight changelog");
    const { added, changed } = parseChangelog(html);
    console.log(`  changelog: ${added.length} entries, ${changed.length} rarity changes.`);
    if (added.length === 0 && changed.length === 0) {
      throw new Error("changelog parsed zero entries - page structure may have changed, refusing to advance state");
    }
    const byCore = new Map<string, Entry>();
    for (const f of FILES) for (const e of db[f.file]) byCore.set(equiv(e.name), e);

    for (const a of added) {
      const { folder, name } = splitPath(a.path);
      const k = equiv(name);
      if (byCore.has(k)) continue; // known icon: the changelog's historical path may be outdated
      const target = FILES.find(ff => a.path.toLowerCase().startsWith(ff.pathPrefix));
      if (!target) continue;
      const entry: Entry = { name, details: { folder, rarity: a.rarity } };
      db[target.file].push(entry);
      byCore.set(k, entry);
      bump("added");
      console.log(`  + ${a.path} [${a.rarity}]`);
    }
    for (const c of [...changed].reverse()) {
      const { name } = splitPath(c.path);
      const hit = byCore.get(equiv(name));
      if (!hit || hit.details.rarity !== c.from) continue; // 100% or skip
      hit.details.rarity = c.to;
      bump("rarity_changed");
      console.log(`  ${name}: ${c.from} -> ${c.to}`);
    }
    state.nightlight_version = curVersion;
  }

  // ---- Write only on real change. ----
  let wrote = false;
  for (const f of FILES) {
    if (JSON.stringify(db[f.file]) !== original[f.file]) {
      if (!dryRun) await Bun.write(f.file, JSON.stringify(db[f.file], null, 2) + "\n");
      wrote = true;
    }
  }
  if (!dryRun) await Bun.write(STATE_PATH, JSON.stringify(state, null, 2) + "\n");

  console.log("\n--- summary ---");
  for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
  console.log(dryRun ? "(dry run: nothing written)" : wrote ? "files updated." : "no changes.");
}

if (import.meta.main) {
  main().catch(err => { console.error("FAILED:", err.message); process.exit(1); });
}
