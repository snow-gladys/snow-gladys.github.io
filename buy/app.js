export const CATEGORIES = ["全部", "嘉然", "乃琳", "贝拉", "思诺", "心宜", "其他"];
export const SORT_MODES = {
  DEFAULT: "default",
  UNREACHED_SALES_DESC: "unreached-sales-desc",
};
const CATEGORY_SEPARATOR = "|";
const NAMED_CATEGORIES = CATEGORIES.filter((category) => category !== "全部" && category !== "其他");

export const WEIDIAN_ENDPOINT =
  "https://thor.weidian.com/decorate/shopDetail.sync.getItemListForCommonItemSection/1.0";
export const SNAPSHOT_ITEMS_URL = "data/live-items.json";

export const WEIDIAN_PARAMS = {
  ctx: "0;0;0;1733177613;0;0;0;0;0;-1;-1;0;0;0;0",
  sectionId: 501,
  shopId: 1733177613,
};

const CATEGORY_PATTERNS = [
  ["嘉然", ["嘉然", "嘉心糖", "然驼", "小恶魔然", "月牙然"]],
  ["乃琳", ["乃琳", "琳"]],
  ["贝拉", ["贝拉", "拉姐", "贝极星", "拉驼"]],
  ["思诺", ["思诺", "诺驼", "铁柱"]],
  ["心宜", ["心宜", "宜驼"]],
];

export function parseCsv(text) {
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

export function toCsv(rows, headers) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };

  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(escapeCell).join(","))
    .join("\n");
}

export function classifyTitle(title) {
  const text = String(title || "");
  const matches = CATEGORY_PATTERNS.filter(([, keywords]) =>
    keywords.some((keyword) => text.includes(keyword)),
  ).map(([category]) => category);

  return matches.length ? matches.join(CATEGORY_SEPARATOR) : "其他";
}

export function parseCategoryList(value) {
  const tokens = String(value || "")
    .split(/[|、,，\/;\s]+/)
    .map((category) => category.trim())
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const categories = NAMED_CATEGORIES.filter((category) => tokenSet.has(category));

  return categories.length ? categories : ["其他"];
}

export function salesDistance(sold, target) {
  const current = Number.parseInt(sold, 10);
  const normalized = Number.isFinite(current) ? current : 0;
  const remaining = Math.max(target - normalized, 0);
  return { reached: remaining === 0, remaining };
}

export function progressState(distance, target) {
  const normalizedTarget = Math.max(Number.parseInt(target, 10) || 0, 0);
  if (!normalizedTarget) return { percent: 0, tone: "low" };
  if (distance.reached) return { percent: 100, tone: "reached" };

  const remaining = Math.max(Number.parseInt(distance.remaining, 10) || 0, 0);
  const completed = Math.max(normalizedTarget - remaining, 0);
  const percent = Math.min(Math.round((completed / normalizedTarget) * 100), 100);
  const tone = percent < 50 ? "low" : "mid";

  return { percent, tone };
}

function normalizedSales(value) {
  const current = Number.parseInt(value, 10);
  return Number.isFinite(current) ? current : 0;
}

export function sortProducts(products, sortMode = SORT_MODES.DEFAULT) {
  if (sortMode !== SORT_MODES.UNREACHED_SALES_DESC) return [...products];

  return products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => {
      const leftReached = Boolean(left.product.distance50?.reached);
      const rightReached = Boolean(right.product.distance50?.reached);
      if (leftReached !== rightReached) return leftReached ? 1 : -1;

      const salesDiff = normalizedSales(right.product.sold) - normalizedSales(left.product.sold);
      return salesDiff || left.index - right.index;
    })
    .map(({ product }) => product);
}

export function formatDeadline(deadline) {
  const value = String(deadline || "").trim();
  return value || "未知成团日期";
}

export function formatWeidianError(payload) {
  const code = payload?.status?.code;
  const message = payload?.status?.message || "微店接口返回异常";

  if (code === 18) {
    return "微店跨域限制：请用 http://127.0.0.1:8000/ 或 http://localhost:8000/ 打开，不要用 http://[::]:8000/";
  }

  return message;
}

export function isEnabled(row) {
  return String(row.enabled || "").trim().toLowerCase() === "true";
}

export function mergeProducts(configRows, liveItems) {
  const liveById = new Map(liveItems.map((item) => [String(item.itemId), item]));

  return configRows.filter(isEnabled).map((row) => {
    const itemId = String(row.itemId || "").trim();
    const live = liveById.get(itemId);
    const sold = live?.sold ?? "";
    const configuredCategories = parseCategoryList(row.category);
    const titleCategories = parseCategoryList(classifyTitle(live?.itemName || ""));
    const categories =
      configuredCategories[0] === "其他" && titleCategories[0] !== "其他"
        ? titleCategories
        : configuredCategories;
    const category = categories.join(CATEGORY_SEPARATOR);

    return {
      itemId,
      category,
      categories,
      deadline: row.deadline || "",
      deadlineLabel: formatDeadline(row.deadline),
      enabled: true,
      name: live?.itemName || `商品 ${itemId}`,
      image: row.image || live?.itemImg || "",
      sold,
      price: live?.price || "",
      stock: live?.stock ?? "",
      url: live?.itemUrl || `https://weidian.com/item.html?itemID=${encodeURIComponent(itemId)}`,
      missing: !live,
      distance50: salesDistance(sold, 50),
      distance100: salesDistance(sold, 100),
    };
  });
}

export function buildWeidianUrl(itemIds) {
  const param = {
    ...WEIDIAN_PARAMS,
    itemList: itemIds.map((id) => String(id)),
  };
  return `${WEIDIAN_ENDPOINT}?param=${encodeURIComponent(JSON.stringify(param))}`;
}

export async function fetchLiveItems(itemIds, fetcher = fetch) {
  if (!itemIds.length) return [];

  const response = await fetcher(buildWeidianUrl(itemIds), {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`微店接口请求失败：${response.status}`);
  }

  const payload = await response.json();
  if (payload?.status?.code !== 0) {
    throw new Error(formatWeidianError(payload));
  }

  return payload?.result?.itemList || [];
}

export function normalizeLiveItemsPayload(payload) {
  if (Array.isArray(payload)) return { items: payload, updatedAt: "" };
  if (Array.isArray(payload?.items)) return { items: payload.items, updatedAt: payload.updatedAt || "" };
  if (Array.isArray(payload?.result?.itemList)) {
    return { items: payload.result.itemList, updatedAt: payload.updatedAt || "" };
  }
  return { items: [], updatedAt: payload?.updatedAt || "" };
}

export async function fetchSnapshotItems(fetcher = fetch) {
  const response = await fetcher(SNAPSHOT_ITEMS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`快照数据加载失败：${response.status}`);
  return normalizeLiveItemsPayload(await response.json());
}

export async function fetchLiveItemsWithFallback(itemIds, fetcher = fetch) {
  try {
    return {
      items: await fetchLiveItems(itemIds, fetcher),
      source: "live",
      updatedAt: "",
      error: "",
    };
  } catch (error) {
    const snapshot = await fetchSnapshotItems(fetcher);
    return {
      items: snapshot.items,
      source: "snapshot",
      updatedAt: snapshot.updatedAt,
      error: error.message || "实时数据获取失败",
    };
  }
}

export function shouldUseDirectLiveFetch(locationLike = globalThis.location) {
  const hostname = locationLike?.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function loadLiveItemsForCurrentOrigin(itemIds, fetcher = fetch, locationLike = globalThis.location) {
  if (shouldUseDirectLiveFetch(locationLike)) {
    return fetchLiveItemsWithFallback(itemIds, fetcher);
  }

  const snapshot = await fetchSnapshotItems(fetcher);
  return {
    items: snapshot.items,
    source: "snapshot",
    updatedAt: snapshot.updatedAt,
    error: "线上环境使用同源快照，避免微店接口跨域限制",
  };
}

export function filterProducts(products, category) {
  if (!category || category === "全部") return products;
  return products.filter((product) => {
    const categories = Array.isArray(product.categories) ? product.categories : parseCategoryList(product.category);
    return categories.includes(category);
  });
}

function setText(selector, text) {
  const target = document.querySelector(selector);
  if (target) target.textContent = text;
}

function renderFilters(products, activeCategory) {
  const filterRoot = document.querySelector("[data-filters]");
  if (!filterRoot) return;

  filterRoot.innerHTML = CATEGORIES.map((category) => {
    const count = category === "全部" ? products.length : filterProducts(products, category).length;
    const active = category === activeCategory ? "true" : "false";
    return `<button class="filter-button" type="button" data-category="${category}" aria-pressed="${active}">
      <span>${category}</span><b>${count}</b>
    </button>`;
  }).join("");
}

function progressMarkup(distance, label, target) {
  const progress = progressState(distance, target);
  const className = `metric metric-${progress.tone}`;
  const value = distance.reached ? "已达成" : distance.remaining;
  return `<div class="${className}" style="--metric-fill: ${progress.percent}%;" aria-label="${label} 完成 ${progress.percent}%"><span>${label}</span><strong>${value}</strong></div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value) {
  try {
    const base = globalThis.location?.href || "https://weidian.com/";
    const url = new URL(String(value || ""), base);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    return "";
  }
  return "";
}

export function productRowMarkup(product) {
  const sold = product.sold === "" ? "未知" : product.sold;
  const name = escapeHtml(product.name);
  const categories = Array.isArray(product.categories) ? product.categories : parseCategoryList(product.category);
  const category = escapeHtml(categories.join(CATEGORY_SEPARATOR));
  const categoryTags = categories.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  const deadline = escapeHtml(product.deadlineLabel);
  const url = escapeHtml(safeUrl(product.url));
  const imageUrl = safeUrl(product.image);
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" loading="lazy">`
    : `<div class="image-placeholder">无图</div>`;
  const missing = product.missing ? `<span class="warn">商品未在实时接口中找到</span>` : "";

  return `<article class="product-row" data-category="${category}">
    <a class="product-image" href="${url}" target="_blank" rel="noreferrer">${image}</a>
    <div class="product-main">
      <div class="product-kicker">
        ${categoryTags}
        <span>${deadline}</span>
        ${missing}
      </div>
      <a class="product-title" href="${url}" target="_blank" rel="noreferrer">${name}</a>
      <div class="product-meta">
        <span>销量 ${escapeHtml(sold)}</span>
        ${product.price ? `<span>¥${escapeHtml(product.price)}</span>` : ""}
        ${product.stock !== "" ? `<span>库存 ${escapeHtml(product.stock)}</span>` : ""}
      </div>
    </div>
    <div class="product-progress">
      ${progressMarkup(product.distance50, "距50", 50)}
      ${progressMarkup(product.distance100, "距100", 100)}
    </div>
  </article>`;
}

export function renderProducts(products, activeCategory = "全部", sortMode = SORT_MODES.DEFAULT) {
  const listRoot = document.querySelector("[data-product-list]");
  const emptyRoot = document.querySelector("[data-empty]");
  if (!listRoot || !emptyRoot) return;

  const visible = sortProducts(filterProducts(products, activeCategory), sortMode);
  listRoot.innerHTML = visible.map(productRowMarkup).join("");
  emptyRoot.hidden = visible.length > 0;

  const reached50 = products.filter((product) => product.distance50.reached).length;
  const reached100 = products.filter((product) => product.distance100.reached).length;
  setText("[data-total-count]", String(products.length));
  setText("[data-reached-50]", String(reached50));
  setText("[data-reached-100]", String(reached100));
}

export async function loadDashboard() {
  const state = { products: [], activeCategory: "全部", sortMode: SORT_MODES.DEFAULT };
  const statusRoot = document.querySelector("[data-status]");
  const refreshButton = document.querySelector("[data-refresh]");
  const sortButton = document.querySelector("[data-sort-unreached]");

  function render() {
    renderFilters(state.products, state.activeCategory);
    renderProducts(state.products, state.activeCategory, state.sortMode);
    if (sortButton) {
      sortButton.setAttribute(
        "aria-pressed",
        String(state.sortMode === SORT_MODES.UNREACHED_SALES_DESC),
      );
    }
  }

  async function refresh() {
    if (statusRoot) statusRoot.textContent = "更新中";
    if (refreshButton) refreshButton.disabled = true;

    try {
      const csvResponse = await fetch("data/products.csv", { cache: "no-store" });
      if (!csvResponse.ok) throw new Error(`CSV 加载失败：${csvResponse.status}`);

      const configRows = parseCsv(await csvResponse.text());
      const enabledRows = configRows.filter(isEnabled);
      const liveResult = await loadLiveItemsForCurrentOrigin(enabledRows.map((row) => row.itemId));
      const liveItems = liveResult.items;
      state.products = mergeProducts(configRows, liveItems);
      render();
      const now = new Date();
      if (statusRoot) {
        if (liveResult.source === "snapshot") {
          const snapshotTime = liveResult.updatedAt
            ? new Date(liveResult.updatedAt).toLocaleString("zh-CN", { hour12: false })
            : "";
          statusRoot.textContent = snapshotTime
            ? `实时接口受限，显示快照 ${snapshotTime}`
            : "实时接口受限，显示本地快照";
        } else {
          statusRoot.textContent = `已更新 ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
        }
      }
    } catch (error) {
      if (statusRoot) statusRoot.textContent = error.message || "实时数据获取失败";
      render();
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  document.querySelector("[data-filters]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.activeCategory = button.dataset.category;
    render();
  });

  sortButton?.addEventListener("click", () => {
    state.sortMode =
      state.sortMode === SORT_MODES.UNREACHED_SALES_DESC
        ? SORT_MODES.DEFAULT
        : SORT_MODES.UNREACHED_SALES_DESC;
    render();
  });

  refreshButton?.addEventListener("click", refresh);
  await refresh();
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
  });
}
