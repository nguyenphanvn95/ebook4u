// lib/cache.js
//
// Cache toàn bộ metadata đã build-index trong RAM của tiến trình serverless function.
// Lưu ý: mỗi container Vercel có RAM riêng — cache này KHÔNG chia sẻ giữa các instance,
// nhưng vẫn hữu ích vì Vercel tái sử dụng container "warm" cho nhiều request liên tiếp,
// giúp giảm mạnh số lần phải tải lại metadata_public.json từ Google Drive.

import { METADATA_URL, GDRIVE_PROXY_URL, CACHE_TTL_MS } from "../config.js";
import { buildLibraryIndex } from "./metadata.js";
import { fetchWithTimeout, fetchDirectWithConfirm, resolveDriveFileId } from "./gdrive.js";

let cache = {
  data: null, // { books, idIndex, authorIndex, tagIndex, seriesIndex, newestSorted }
  fetchedAt: 0,
  lastError: null,
};

function log(...args) {
  // Log ra console — Vercel tự động thu thập vào Function Logs.
  console.log("[opds]", new Date().toISOString(), ...args);
}

/** Parse JSON, kèm thông báo rõ ràng nếu server trả về HTML (trang lỗi/đăng nhập/virus-scan) thay vì JSON. */
function parseJsonStrict(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    throw new Error(
      "METADATA_NOT_JSON: URL trả về HTML thay vì JSON (file có thể chưa được chia sẻ " +
        '"Anyone with the link", hoặc bị Google chặn anti-bot). Hãy dùng GDRIVE_PROXY_URL.'
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`METADATA_INVALID_JSON: ${err.message}`);
  }
}

async function fetchMetadataJson() {
  const start = Date.now();

  // Ưu tiên proxy Apps Script nếu đã cấu hình — ổn định nhất, tránh anti-bot/virus-scan của Drive.
  if (GDRIVE_PROXY_URL) {
    const fileId = resolveDriveFileId(METADATA_URL) || METADATA_URL;
    const proxyUrl = `${GDRIVE_PROXY_URL}?id=${encodeURIComponent(fileId)}`;
    try {
      const res = await fetchWithTimeout(proxyUrl);
      if (!res.ok) throw new Error(`Fetch metadata qua proxy thất bại: HTTP ${res.status}`);
      const text = await res.text();
      const json = parseJsonStrict(text);
      log("Apps Script proxy fetch OK", `${Date.now() - start}ms`);
      return json;
    } catch (err) {
      log("proxy lỗi, thử fallback gọi thẳng Google Drive:", err.message);
      // rơi xuống fallback bên dưới
    }
  }

  // Gọi thẳng METADATA_URL — tự động vượt qua trang cảnh báo virus-scan của Drive nếu gặp.
  try {
    const file = await fetchDirectWithConfirm(METADATA_URL);
    const json = parseJsonStrict(file.buffer.toString("utf-8"));
    log("Google Drive fetch OK", `${Date.now() - start}ms`);
    return json;
  } catch (err) {
    // fetchDirectWithConfirm ném lỗi dạng DRIVE_FETCH_FAILED_xxx / DRIVE_CONFIRM_TOKEN_NOT_FOUND;
    // fallback thêm 1 lần fetch "trần" (không xử lý confirm) để không bỏ sót trường hợp URL
    // là link JSON thuần (không phải Drive) như Apps Script /exec URL.
    try {
      const res = await fetchWithTimeout(METADATA_URL);
      if (!res.ok) throw new Error(`Fetch metadata thất bại: HTTP ${res.status}`);
      const text = await res.text();
      const json = parseJsonStrict(text);
      log("Fetch trực tiếp (fallback) OK", `${Date.now() - start}ms`);
      return json;
    } catch (err2) {
      throw new Error(`Không thể tải metadata: ${err.message} / ${err2.message}`);
    }
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
