import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ZIP_URL = "https://nightlight.gg/packs/default-icons/download";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RARITY_MAPS = {
  "Add-ons": ["Common", "Uncommon", "Rare", "Very_Rare", "Visceral", "Event"],
  Items: ["Common", "Uncommon", "Rare", "Very_Rare", "Event"],
  Offerings: ["Common", "Uncommon", "Rare", "Very_Rare", "Visceral", "Event"],
};

const typeToFolderMap = {
  "Add-ons": "ItemAddons/",
  Items: "Items/",
  Offerings: "Favors/",
};

const prefixToType = {
  iconAddon_: "Add-ons",
  iconItems_: "Items",
  iconFavors_: "Offerings",
};

interface IconData {
  name: string;
  details: {
    folder: string;
    rarity: string;
  };
}

async function fetchWikiRarityData() {
  console.log("🔍 Fetching Rarity data from Wiki...");
  const filenameToRarity = new Map<string, string>();

  for (const [type, rarities] of Object.entries(RARITY_MAPS)) {
    for (const rarity of rarities) {
      const categoryName = `${rarity}_${type}`;
      const params = new URLSearchParams({
        action: "query",
        generator: "categorymembers",
        gcmtitle: `Category:${categoryName}`,
        gcmlimit: "max",
        prop: "pageimages",
        piprop: "name",
        format: "json",
        origin: "*",
      });

      try {
        const response = await fetch(`https://deadbydaylight.wiki.gg/api.php?${params}`);
        const data: any = await response.json();
        const pages = data.query?.pages;

        if (pages) {
          Object.values(pages).forEach((page: any) => {
            if (page.pageimage) {
              const filename = page.pageimage;
              const correctedFilename = filename.charAt(0).toLowerCase() + filename.slice(1);
              filenameToRarity.set(correctedFilename, rarity.toLowerCase());
            }
          });
        }
      } catch (err) {
        console.error(`❌ Error fetching category ${categoryName}:`, err);
      }
    }
  }

  console.log(`✅ Indexed ${filenameToRarity.size} filenames with rarity.`);
  return filenameToRarity;
}

async function getZipFilenames() {
  console.log("📥 Downloading ZIP from Nightlight...");
  const zipPath = "nightlight_icons.zip";
  
  // Use curl to download due to possible redirects and headers
  const curl = spawnSync("curl.exe", ["-L", "-A", USER_AGENT, "-o", zipPath, ZIP_URL]);
  if (curl.status !== 0) {
    console.error("❌ Failed to download ZIP:", curl.stderr.toString());
    // Fallback to fetch if curl.exe is not available (Linux)
    const res = await fetch(ZIP_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(zipPath, Buffer.from(buffer));
  }

  console.log("📂 Listing files in ZIP...");
  let output = "";
  try {
    const unzip = spawnSync("unzip", ["-l", zipPath]);
    if (unzip.stdout) output = unzip.stdout.toString();
  } catch (e) {}

  if (!output) {
    console.log("⚠️ 'unzip' not found, trying PowerShell...");
    try {
        const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Path ${zipPath} -DestinationPath temp_icons -Force; Get-ChildItem -Path temp_icons -Recurse | Select-Object -ExpandProperty Name`]);
        if (ps.stdout) output = ps.stdout.toString();
    } catch (e) {
        console.error("❌ Failed to list ZIP files with PowerShell:", e);
    }
  }

  if (!output) {
      throw new Error("Could not list ZIP files using 'unzip' or 'PowerShell'.");
  }

  const lines = output.split(/\r?\n/);
  const filenames = lines
    .map(line => line.trim())
    .filter(line => line.endsWith(".png"))
    .map(line => {
        // Handle 'unzip -l' format vs 'Get-ChildItem' format
        const match = line.match(/\d{2}:\d{2}\s+(.+)$/);
        return match ? match[1] : line;
    })
    .map(name => path.basename(name));

  console.log(`✅ Found ${filenames.length} PNG files in ZIP.`);
  return filenames;
}

async function run() {
  try {
    const wikiMap = await fetchWikiRarityData();
    const zipFiles = await getZipFilenames();

    const filePaths = {
      "Add-ons": "./dbdItemAddons.json",
      Items: "./dbdItems.json",
      Offerings: "./dbdOfferings.json",
    };

    const dataSets: Record<string, Map<string, IconData["details"]>> = {
      "Add-ons": new Map(),
      Items: new Map(),
      Offerings: new Map(),
    };

    // Load existing data
    for (const [type, path] of Object.entries(filePaths)) {
      if (fs.existsSync(path)) {
        const data: IconData[] = JSON.parse(fs.readFileSync(path, "utf-8"));
        data.forEach(item => dataSets[type].set(item.name, item.details));
        console.log(`📖 Loaded ${dataSets[type].size} items from ${path}`);
      }
    }

    let addedCount = 0;
    let updatedCount = 0;

    for (const filename of zipFiles) {
      let type: string | undefined;
      for (const [prefix, t] of Object.entries(prefixToType)) {
        if (filename.startsWith(prefix)) {
          type = t;
          break;
        }
      }

      if (!type) continue;

      const rarity = wikiMap.get(filename) || "unknown";
      const folder = typeToFolderMap[type as keyof typeof typeToFolderMap];

      const existing = dataSets[type].get(filename);
      if (!existing) {
        dataSets[type].set(filename, { folder, rarity });
        addedCount++;
        console.log(`➕ Added: ${filename} (${rarity})`);
      } else if (existing.rarity !== rarity && rarity !== "unknown") {
        dataSets[type].set(filename, { ...existing, rarity });
        updatedCount++;
        console.log(`🔄 Updated rarity: ${filename} (${existing.rarity} -> ${rarity})`);
      }
    }

    // Write back
    for (const [type, path] of Object.entries(filePaths)) {
      const list = Array.from(dataSets[type].entries()).map(([name, details]) => ({
        name,
        details,
      }));
      // Sort to keep it clean
      list.sort((a, b) => a.name.localeCompare(b.name));
      fs.writeFileSync(path, JSON.stringify(list, null, 2));
    }

    console.log(`✨ Sync complete. Added ${addedCount}, updated ${updatedCount} items.`);

    // Cleanup
    if (fs.existsSync("nightlight_icons.zip")) fs.unlinkSync("nightlight_icons.zip");
    if (fs.existsSync("temp_icons")) fs.rmSync("temp_icons", { recursive: true, force: true });

  } catch (err) {
    console.error("❌ Fatal error:", err);
  }
}

run();
