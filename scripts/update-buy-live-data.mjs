import { readFile, writeFile } from "node:fs/promises";

const WEIDIAN_ENDPOINT =
  "https://thor.weidian.com/decorate/shopDetail.sync.getItemListForCommonItemSection/1.0";
const WEIDIAN_PARAMS = {
  ctx: "0;0;0;1733177613;0;0;0;0;0;-1;-1;0;0;0;0",
  sectionId: 501,
  shopId: 1733177613,
};

const siteDir = process.env.SITE_DIR || "buy";
const productsPath = `${siteDir}/data/products.csv`;
const outputPath = `${siteDir}/data/live-items.json`;

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  const [headers = [], ...records] = rows;
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), record[index] ?? ""])),
  );
}

function buildWeidianUrl(itemIds) {
  const param = {
    ...WEIDIAN_PARAMS,
    itemList: itemIds.map((id) => String(id)),
  };
  return `${WEIDIAN_ENDPOINT}?param=${encodeURIComponent(JSON.stringify(param))}`;
}

function isEnabled(row) {
  return String(row.enabled || "").trim().toLowerCase() === "true";
}

const rows = parseCsv(await readFile(productsPath, "utf8"));
const itemIds = rows.filter(isEnabled).map((row) => row.itemId).filter(Boolean);
const response = await fetch(buildWeidianUrl(itemIds), {
  headers: {
    origin: "http://localhost:8000",
    referer: "http://localhost:8000/",
    "user-agent": "Mozilla/5.0 (compatible; buy-dashboard-updater/1.0)",
  },
});

if (!response.ok) {
  throw new Error(`Weidian request failed: ${response.status}`);
}

const payload = await response.json();
if (payload?.status?.code !== 0) {
  throw new Error(payload?.status?.message || "Weidian API returned an error");
}

const items = payload?.result?.itemList || [];
await writeFile(outputPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2)}\n`);
console.log(`Updated ${outputPath} with ${items.length} items`);
