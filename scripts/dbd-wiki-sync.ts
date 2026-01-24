const ADDON_RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Very_Rare",
  "Visceral",
  "Event",
]; //Add-ons
const ITEM_RARITIES = ["Common", "Uncommon", "Rare", "Very_Rare", "Event"]; // Items use Ultra Rare instead of Visceral usually
const OFFERING_RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Very_Rare",
  "Visceral",
  "Event",
];

interface IconData {
  name: string;
  details: {
    folder: string;
    rarity: string;
  };
}

const typeToFolderMap = {
  "Add-ons": "ItemAddons/",
  Items: "Items/",
  Offerings: "Favors/",
};

async function syncWikiCat(
  type: "Add-ons" | "Items" | "Offerings",
  rarityList: string[],
) {
  const outputPath = `./dbd${type.replace("Add-ons", "ItemAddons").replace("Items", "Items").replace("Offerings", "Offerings")}.json`;
  let finalDataMap = new Map<string, { folder: string; rarity: string }>();

  // 1. Read the local file and populate the map, which becomes our source of truth.
  try {
    const existingData: IconData[] = await Bun.file(outputPath).json();
    finalDataMap = new Map(
      existingData.map((item) => [item.name, item.details]),
    );
    console.log(
      `🗺️ Loaded ${finalDataMap.size} existing items from ${type}_map.json.`,
    );
  } catch (err) {
    console.log(`No existing ${type} map found, creating a new one.`);
  }

  const baseFolder = typeToFolderMap[type];

  // 2. Loop through wiki data and update/add to the map.
  for (const rarity of rarityList) {
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
      const response = await fetch(
        `https://deadbydaylight.wiki.gg/api.php?${params}`,
      );
      const data = await response.json();
      const pages = data.query?.pages;

      if (pages) {
        Object.values(pages).forEach((page: any) => {
          if (page.pageimage) {
            const filename = page.pageimage;
            const correctedFilename =
              filename.charAt(0).toLowerCase() + filename.slice(1);
            const newRarity = rarity.toLowerCase();

            // Get existing details if they exist, otherwise use a default.
            const existingDetails = finalDataMap.get(correctedFilename) || {
              folder: baseFolder, // Default for new items
              rarity: "", // Will be overwritten
            };

            // Update the map. This adds new items and updates existing ones.
            finalDataMap.set(correctedFilename, {
              folder: existingDetails.folder, // Preserve existing folder
              rarity: newRarity, // Always update rarity from wiki
            });
          }
        });
        console.log(
          `✅ Synced ${Object.keys(pages).length} items for ${categoryName}`,
        );
      }
    } catch (err) {
      console.error(`❌ Error fetching ${categoryName}:`, err);
    }
  }

  // 3. Convert the map back to an array.
  const finalItemList: IconData[] = Array.from(finalDataMap.entries()).map(
    ([name, details]) => ({
      name,
      details,
    }),
  );

  // 4. Write the final, preserved list back to the file.
  try {
    console.log(`📝 Writing updated data to ${outputPath}...`);
    await Bun.write(outputPath, JSON.stringify(finalItemList, null, 2));
    console.log(`✅ Successfully wrote data to ${outputPath}.`);
  } catch (writeErr) {
    console.error(`❌ Error writing to ${outputPath}:`, writeErr);
  }
}

async function run() {
  console.log("🚀 Starting Global Wiki Sync...");

  await syncWikiCat("Add-ons", ADDON_RARITIES);
  await syncWikiCat("Items", ITEM_RARITIES);
  await syncWikiCat("Offerings", OFFERING_RARITIES);

  console.log("✨ All data files updated successfully!");
}

run();
