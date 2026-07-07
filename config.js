// config.js
// Cấu hình trung tâm cho toàn bộ dự án OPDS Server.
// KHÔNG hardcode URL trong code nghiệp vụ — mọi nơi khác phải import từ đây.

/**
 * URL public trỏ tới file metadata_public.json.
 * Có thể là:
 *  - Link Google Drive "uc?export=download&id=..." trỏ thẳng tới file JSON public
 *  - Link Web App Google Apps Script (…/exec) trả về JSON
 * Cấu hình qua biến môi trường METADATA_URL trên Vercel (Project Settings > Environment Variables).
 */
export const METADATA_URL =
  process.env.METADATA_URL ||
  "https://raw.githubusercontent.com/example/replace-me/main/metadata_public.json";

/**
 * URL Web App của Google Apps Script dùng để đọc file trên Google Drive
 * (metadata_public.json, epub/pdf/..., ảnh bìa) phía SERVER (qua DriveApp),
 * rồi trả thẳng byte về — cách này tránh được lỗi 403 / chặn anti-bot mà
 * Google hay áp dụng khi gọi link "uc?export=download" trực tiếp.
 *
 * Đây chính là cơ chế mà trang nguyenphanvn95.github.io/mylibrary/ đang dùng
 * (biến GDRIVE_PROXY_URL trong app.js của trang đó). Deploy 1 Apps Script
 * dạng Web App (xem README mục "Google Apps Script proxy") rồi dán URL
 * ".../exec" vào biến môi trường GDRIVE_PROXY_URL trên Vercel.
 *
 * Nếu để trống, server sẽ tự fallback sang gọi thẳng Google Drive
 * (uc?export=download) — vẫn hoạt động với file nhỏ/vừa nhưng kém ổn định
 * hơn với file lớn hoặc khi Google siết anti-bot.
 */
export const GDRIVE_PROXY_URL = process.env.GDRIVE_PROXY_URL || "";

/** Thời gian cache metadata trong RAM (ms). Mặc định 10 phút. */
export const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "", 10) || 10 * 60 * 1000;

/** Số sách mỗi trang OPDS. */
export const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || "", 10) || 100;

/** Thông tin hiển thị catalog. */
export const CATALOG_TITLE = process.env.CATALOG_TITLE || "Thư viện OPDS của tôi";
export const CATALOG_AUTHOR = process.env.CATALOG_AUTHOR || "OPDS Server";
export const CATALOG_ID = "urn:opds-server:root";

/** Content-Type chuẩn OPDS 1.x. */
export const OPDS_CONTENT_TYPE = "application/atom+xml;profile=opds-catalog;charset=utf-8";

/** Content-Type cho single-entry OPDS (dùng cho /api/book). */
export const OPDS_ENTRY_CONTENT_TYPE = "application/atom+xml;type=entry;profile=opds-catalog;charset=utf-8";

/** Timeout (ms) khi gọi tới Google Drive / Apps Script. */
export const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "", 10) || 15000;
