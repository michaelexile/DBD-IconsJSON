import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * DEFINITIVE CONFIGURATION
 */
const RARITY_ENUM: Record<number, string> = {
  1: "common", 
  2: "uncommon", 
  3: "rare", 
  4: "very_rare", 
  5: "ultra_rare", 
  8: "event", 
  11: "limited", 
  13: "ultra_rare"
};

const CONFIG = [
  { file: "dbdItems.json", folder: "Items", prefix: "iconItems" },
  { file: "dbdItemAddons.json", folder: "ItemAddons", prefix: "iconAddon" },
  { file: "dbdOfferings.json", folder: "Favors", prefix: "iconFavors" }
];

const ZIP_URL = "https://nightlight.gg/packs/default-icons/download";
const TEMP_EXTRACT_DIR = "temp_nightlight_icons";

// Determine Mode
const arg = process.argv[2];
const isDownloadMode = arg === "--download";
const isRarityOnlyMode = !arg && !!process.env.GITHUB_ACTIONS;
const manualFolderPath = (!isDownloadMode && !isRarityOnlyMode) ? (arg || "temp_extracted_icons") : null;

async function fetchWikiModule(title: string) {
  const url = `https://deadbydaylight.wiki.gg/api.php?action=query&titles=${encodeURIComponent(title)}&prop=revisions&rvprop=content&format=json`;
  const res = await fetch(url);
  const data: any = await res.json();
  const page = data.query.pages[Object.keys(data.query.pages)[0]];
  if (!page.revisions) throw new Error(`Could not find content for ${title}`);
  return page.revisions[0]["*"];
}

function parseWikiTable(lua: string) {
  const data: Record<string, { iconFile?: string; rarity?: number; decom?: boolean }> = {};
  const entryRegex = /\["(.+?)"\]\s*=\s*\{([^}]+)\}/g;
  let match;
  while ((match = entryRegex.exec(lua)) !== null) {
    const itemName = match[1];
    const fieldsText = match[2];
    const entry: any = {};
    const iconMatch = fieldsText.match(/iconFile\s*=\s*"(.+?)"/);
    if (iconMatch) entry.iconFile = iconMatch[1].replace(/ /g, "_");
    const rarityMatch = fieldsText.match(/rarity\s*=\s*(\d+)/);
    if (rarityMatch) entry.rarity = parseInt(rarityMatch[1]);
    if (fieldsText.includes("decom = true")) entry.decom = true;
    data[itemName] = entry;
  }
  return data;
}

function normalize(name: string) {
  return name.toLowerCase()
    .replace(/\.png$/, "")
    .replace(/[^a-z0-9]/g, "") 
    .replace(/pinkie/g, "pinky")
    .replace(/memento/g, "momento")
    .replace(/^iconitems/, "")
    .replace(/^iconaddon/, "")
    .replace(/^iconfavors/, "")
    .replace(/^tui/, "");
}

async function downloadAndExtract() {
  const zipPath = "nightlight_icons.zip";
  console.log(`📥 Downloading icons from Nightlight...`);
  
  const curl = spawnSync("curl", ["-L", "-o", zipPath, ZIP_URL]);
  if (curl.status !== 0) throw new Error("Failed to download ZIP");

  console.log(`📂 Extracting ZIP...`);
  if (fs.existsSync(TEMP_EXTRACT_DIR)) fs.rmSync(TEMP_EXTRACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_EXTRACT_DIR);

  const unzip = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Path ${zipPath} -DestinationPath ${TEMP_EXTRACT_DIR} -Force`]);
  if (unzip.status !== 0) throw new Error("Failed to extract ZIP using PowerShell");

  fs.unlinkSync(zipPath);
  return TEMP_EXTRACT_DIR;
}

async function run() {
  let scanRoot = manualFolderPath;

  if (isDownloadMode) {
    scanRoot = await downloadAndExtract();
  } else if (isRarityOnlyMode) {
    console.log("🤖 Running in GitHub Actions (Rarity Update Only mode)");
  } else {
    console.log(`📂 Scanning local folder: ${path.resolve(scanRoot!)}`);
  }

  console.log("🌐 Fetching latest rarity data from Wiki...");
  try {
    const iconsLua = await fetchWikiModule("Module:Datatable/Icons");
    const loadoutLua = await fetchWikiModule("Module:Datatable/Loadout");

    const iconMap = parseWikiTable(iconsLua);
    const loadoutMap = parseWikiTable(loadoutLua);

    const wikiLookup = new Map<string, { rarity: string }>();
    for (const [displayName, iconData] of Object.entries(iconMap)) {
      if (!iconData.iconFile) continue;
      const loadout = loadoutMap[displayName];
      if (loadout?.decom) continue;
      const rId = loadout?.rarity || iconData.rarity;
      wikiLookup.set(normalize(iconData.iconFile), { rarity: RARITY_ENUM[rId!] || "common" });
    }

    for (const cfg of CONFIG) {
      if (!fs.existsSync(cfg.file)) continue;
      
      console.log(`\n📄 Syncing ${cfg.file}...`);
      let localData = JSON.parse(fs.readFileSync(cfg.file, "utf-8"));
      
      const targetFolder = scanRoot ? path.join(scanRoot, cfg.folder) : null;
      const getAllFiles = (dir: string): string[] => {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) results = results.concat(getAllFiles(fullPath));
          else if (file.endsWith(".png")) results.push(fullPath);
        }
        return results;
      };

      const diskFilesPaths = targetFolder ? getAllFiles(targetFolder) : [];
      const diskFiles = diskFilesPaths.map(p => path.basename(p));
      const diskFileSet = new Set(diskFiles);
      
      const finalEntries = [];
      const processedDiskFiles = new Set();
      let updatedCount = 0;
      let removedCount = 0;
      let addedCount = 0;

      for (const entry of localData) {
        const normJSON = normalize(entry.name);
        let currentName = entry.name;

        if (scanRoot && !diskFileSet.has(entry.name)) {
          const matchOnDisk = diskFiles.find(f => normalize(f) === normJSON);
          if (matchOnDisk) {
            console.log(`  🔄 Renaming: ${entry.name} -> ${matchOnDisk}`);
            currentName = matchOnDisk;
            updatedCount++;
          } else {
            console.log(`  🗑️ Removing: ${entry.name}`);
            removedCount++;
            continue;
          }
        }

        const wiki = wikiLookup.get(normalize(currentName));
        if (wiki && entry.details.rarity !== wiki.rarity) {
          console.log(`  ✨ Rarity: ${currentName} (${entry.details.rarity} -> ${wiki.rarity})`);
          entry.details.rarity = wiki.rarity;
          updatedCount++;
        }

        entry.name = currentName;
        finalEntries.push(entry);
        processedDiskFiles.add(currentName);
      }

      if (scanRoot) {
        for (const fullPath of diskFilesPaths) {
          const fileName = path.basename(fullPath);
          if (!processedDiskFiles.has(fileName)) {
            if (fileName.toLowerCase().startsWith(cfg.prefix.toLowerCase()) || fileName.startsWith("T_UI_")) {
              const wiki = wikiLookup.get(normalize(fileName));
              const relativeDir = path.relative(targetFolder!, path.dirname(fullPath));
              const folderPath = `${cfg.folder}/${relativeDir ? relativeDir.replace(/\\/g, "/") + "/" : ""}`;
              console.log(`  ➕ Adding: ${fileName}`);
              finalEntries.push({ name: fileName, details: { folder: folderPath, rarity: wiki ? wiki.rarity : "common" } });
              addedCount++;
            }
          }
        }
      }

      finalEntries.sort((a, b) => a.name.localeCompare(b.name));
      fs.writeFileSync(cfg.file, JSON.stringify(finalEntries, null, 2));
      console.log(`✅ ${cfg.file} Done: ${updatedCount} updated, ${addedCount} added, ${removedCount} removed.`);
    }

    if (isDownloadMode && fs.existsSync(TEMP_EXTRACT_DIR)) {
      console.log(`\n🧹 Cleaning up temporary files...`);
      fs.rmSync(TEMP_EXTRACT_DIR, { recursive: true, force: true });
    }

    console.log("\n🚀 Sync Complete!");

  } catch (err: any) {
    console.error(`❌ Sync Failed: ${err.message}`);
  }
}

run();
