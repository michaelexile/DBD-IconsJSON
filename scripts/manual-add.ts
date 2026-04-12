import fs from "node:fs";
import path from "node:path";

// Mapping local folder names to the target JSON files and their internal 'folder' tag
const folderConfig = {
  "ItemAddons": {
    json: "./dbdItemAddons.json",
    tag: "ItemAddons/"
  },
  "Items": {
    json: "./dbdItems.json",
    tag: "Items/"
  },
  "Favors": {
    json: "./dbdOfferings.json",
    tag: "Favors/"
  },
  "Offerings": { // Support both names just in case
    json: "./dbdOfferings.json",
    tag: "Favors/"
  }
};

const rarityMap: Record<string, string> = {
  c: "common",
  u: "uncommon",
  r: "rare",
  vr: "very rare",
  ur: "ultra rare",
  v: "visceral",
  e: "event",
};

const rarityOptions = Object.entries(rarityMap)
  .map(([k, v]) => `${k}=${v}`)
  .join(", ");

interface IconData {
  name: string;
  details: {
    folder: string;
    rarity: string;
  };
}

async function run() {
  const rootDir = process.argv[2];
  if (!rootDir || !fs.existsSync(rootDir)) {
    console.error("❌ Please provide the path to your extracted icons folder.");
    console.log('Usage: bun scripts/manual-add.ts "C:/Path/To/Icons"');
    process.exit(1);
  }

  const allData: Record<string, Map<string, IconData["details"]>> = {};
  
  // Initialize data maps for all configured JSONs
  for (const config of Object.values(folderConfig)) {
    if (!allData[config.json]) {
      allData[config.json] = new Map();
      if (fs.existsSync(config.json)) {
        const data: IconData[] = JSON.parse(fs.readFileSync(config.json, "utf-8"));
        data.forEach(item => allData[config.json].set(item.name, item.details));
      }
    }
  }

  let addedCount = 0;

  // Scan the subfolders
  for (const [subDirName, config] of Object.entries(folderConfig)) {
    const fullSubPath = path.join(rootDir, subDirName);
    if (!fs.existsSync(fullSubPath)) continue;

    console.log(`📂 Scanning ${subDirName}...`);
    const files = fs.readdirSync(fullSubPath).filter(f => f.endsWith(".png"));

    for (const filename of files) {
      if (filename.includes("Limited")) continue; // Skip limited items

      const existingMap = allData[config.json];
      if (!existingMap.has(filename)) {
        console.log(`\nNew Icon Found: ${path.join(subDirName, filename)}`);
        const input = prompt(`Enter Rarity (${rarityOptions}) or Enter to skip: `);
        
        if (input && rarityMap[input.toLowerCase().trim()]) {
          const rarity = rarityMap[input.toLowerCase().trim()];
          existingMap.set(filename, {
            folder: config.tag,
            rarity: rarity
          });
          addedCount++;
          console.log(`✅ Staged: ${filename} as ${rarity}`);
        } else {
          console.log(`⏭️  Skipped ${filename}`);
        }
      }
    }
  }

  // Write back updated JSON files
  if (addedCount > 0) {
    for (const [jsonPath, map] of Object.entries(allData)) {
      const list = Array.from(map.entries()).map(([name, details]) => ({
        name,
        details
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      fs.writeFileSync(jsonPath, JSON.stringify(list, null, 2));
      console.log(`📝 Updated ${jsonPath}`);
    }
    console.log(`\n✨ Successfully added ${addedCount} new icons!`);
  } else {
    console.log("\n✨ No new icons were added.");
  }
}

run();
