// lib/cache.js
//
// Cache toàn bộ metadata đã build-index trong RAM của tiến trình serverless function.
// Lưu ý: mỗi container Vercel có RAM riêng — cache này KHÔNG chia sẻ giữa các instance,
// nhưng vẫn hữu ích vì Vercel tái sử dụng container "warm" cho nhiều request liên tiếp,
// giúp giảm mạnh số lần phải tải lại metadata_public.json từ Google Drive.

import { METADATA_URL, CACHE_TTL_MS, FETCH_TIMEOUT_MS } from "../config.js";
import { buildLibraryIndex } from "./metadata.js";

let cache = {
  data: null, // { books, idIndex, authorIndex, tagIndex, seriesIndex, newestSorted }
  fetchedAt: 0,
  lastError: null,
};

function log(...args) {
  // Log ra console — Vercel tự động thu thập vào Function Logs.
  console.log("[opds]", new Date().toISOString(), ...args);
}

async function fetchMetadataJson() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(METADATA_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Fetch metadata thất bại: HTTP ${res.status}`);
    }
    const json = await res.json();
    log("Google Drive fetch OK", `${Date.now() - start}ms`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lấy dữ liệu thư viện đã index, có cache 10 phút.
 * - Cache còn hạn -> trả ngay, KHÔNG gọi Google Drive.
 * - Cache hết hạn -> tải lại; nếu tải lỗi mà vẫn còn cache cũ -> dùng tạm cache cũ.
 * - Chưa có cache & tải lỗi -> throw để endpoint tự trả XML lỗi hợp lệ.
 */
export async function getLibrary() {
  const now = Date.now();
  const isFresh = cache.data && now - cache.fetchedAt < CACHE_TTL_MS;

  if (isFresh) {
    log("cache hit");
    return cache.data;
  }

  log("cache miss - đang tải metadata mới");
  const start = Date.now();
  try {
    const rawJson = await fetchMetadataJson();
    const indexed = buildLibraryIndex(rawJson);
    cache = { data: indexed, fetchedAt: now, lastError: null };
    log("request time (rebuild index)", `${Date.now() - start}ms`);
    return indexed;
  } catch (err) {
    cache.lastError = err;
    log("lỗi tải metadata:", err.message);
    if (cache.data) {
      log("dùng cache cũ do tải lỗi");
      return cache.data;
    }
    throw err;
  }
}

/** Dùng cho việc debug / health-check nếu cần. */
export function getCacheStatus() {
  return {
    hasData: !!cache.data,
    fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    ageMs: cache.fetchedAt ? Date.now() - cache.fetchedAt : null,
    lastError: cache.lastError ? String(cache.lastError.message || cache.lastError) : null,
  };
}
