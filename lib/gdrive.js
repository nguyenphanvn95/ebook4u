// lib/gdrive.js
//
// Cơ chế này mô phỏng lại đúng cách trang nguyenphanvn95.github.io/mylibrary/
// (xem app.js của trang đó, biến GDRIVE_PROXY_URL + hàm driveFetch) truy cập
// file trên Google Drive:
//
//   1. metadata_public.json chỉ lưu "file_id" trần của từng file (epub/pdf/
//      cover/opf...), KHÔNG lưu URL đầy đủ.
//   2. Cách lấy file ỔN ĐỊNH NHẤT là qua 1 Google Apps Script Web App do
//      chính chủ thư viện deploy (GDRIVE_PROXY_URL), script đó đọc file bằng
//      DriveApp phía server (không qua trình duyệt) rồi trả thẳng byte —
//      tránh được lỗi 403 / trang xác nhận virus-scan mà Google hay chặn khi
//      gọi "uc?export=download" trực tiếp từ fetch() của trình duyệt.
//   3. Nếu không có proxy (hoặc proxy lỗi), fallback sang gọi thẳng các link
//      công khai của Google Drive, kèm xử lý "confirm token" cho file lớn.
//
// Với server Node (Vercel Functions) của chúng ta, gọi trực tiếp Google Drive
// thường ổn định hơn so với gọi từ trình duyệt (không bị CORS/anti-bot theo
// dõi theo phiên trình duyệt), nhưng vẫn có thể dính rào cản virus-scan với
// file lớn hoặc bị Google giới hạn theo IP datacenter — nên ưu tiên dùng lại
// đúng Apps Script proxy sẵn có của thư viện khi được cấu hình.

import { FETCH_TIMEOUT_MS, GDRIVE_PROXY_URL } from "../config.js";
import { Readable } from "node:stream";

/**
 * Trích Drive File ID từ 1 chuỗi bất kỳ: có thể là file_id trần (trường hợp
 * phổ biến nhất trong metadata_public.json thật), hoặc 1 URL đầy đủ (để
 * tương thích ngược với các bản metadata cũ từng lưu link thay vì file_id).
 */
export function resolveDriveFileId(idOrLink) {
  if (!idOrLink || typeof idOrLink !== "string") return null;
  const raw = idOrLink.trim();

  // Trường hợp phổ biến nhất: đã là file_id trần.
  if (/^[a-zA-Z0-9_-]{15,}$/.test(raw)) return raw;

  let m = raw.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/); // .../file/d/<ID>/view
  if (m) return m[1];
  m = raw.match(/[?&]id=([a-zA-Z0-9_-]{10,})/); // open?id=, uc?id=
  if (m) return m[1];
  m = raw.match(/\/d\/([a-zA-Z0-9_-]{10,})\//); // dạng rút gọn /d/<ID>/
  if (m) return m[1];

  return null;
}

// Giữ tên cũ làm alias để tương thích với code gọi extractDriveId ở nơi khác.
export const extractDriveId = resolveDriveFileId;

/** URL gọi qua Apps Script Web App proxy (ưu tiên số 1 nếu đã cấu hình). */
export function driveProxyUrl(fileId) {
  if (!GDRIVE_PROXY_URL) return null;
  return `${GDRIVE_PROXY_URL}?id=${encodeURIComponent(fileId)}`;
}

/** Link "xem trước" gốc của Google Drive — dùng làm link dự phòng hiển thị cho người dùng. */
export function driveViewLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** Link tải trực tiếp "thô" — dùng khi không có proxy hoặc proxy lỗi. */
export function driveDirectDownloadUrl(id) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

/** Link thumbnail công khai của Google Drive — nhẹ, nhanh, client tải thẳng không qua server. */
export function driveThumbnailUrl(id, size = 400) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${size}`;
}

/** Danh sách URL dự phòng để tải trực tiếp bytes 1 file khi không dùng proxy. */
function directDownloadCandidates(id) {
  return [
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
  ];
}

function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

export async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  return withTimeout((signal) => fetch(url, { signal, redirect: "follow" }), ms);
}

/** Tìm confirm token trong HTML cảnh báo virus-scan của Google Drive (khi gọi link trực tiếp). */
function findConfirmToken(html) {
  const patterns = [
    /confirm=([0-9A-Za-z_-]+)&/,
    /name="confirm"\s+value="([0-9A-Za-z_-]+)"/,
    /"downloadUrl":"([^"]+)"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

async function readResponseAsFile(res) {
  if (!res.ok) throw new Error(`DRIVE_FETCH_FAILED_${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    contentLength: res.headers.get("content-length") || String(arrayBuffer.byteLength),
    fileName: nameMatch ? decodeURIComponent(nameMatch[1].replace(/"/g, "")) : null,
  };
}

/** Vượt qua trang cảnh báo virus-scan khi gọi link tải trực tiếp (không qua proxy). */
export async function fetchDirectWithConfirm(url) {
  let res = await fetchWithTimeout(url);
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/html")) {
    const html = await res.text();
    const tokenOrUrl = findConfirmToken(html);
    if (!tokenOrUrl) throw new Error("DRIVE_CONFIRM_TOKEN_NOT_FOUND");
    const nextUrl = tokenOrUrl.startsWith("http")
      ? tokenOrUrl.replace(/\\u0026/g, "&")
      : `${url}${url.includes("?") ? "&" : "?"}confirm=${tokenOrUrl}`;
    res = await fetchWithTimeout(nextUrl);
  }
  return readResponseAsFile(res);
}

/**
 * Tải 1 file Drive theo file_id, LUÔN ưu tiên qua Apps Script proxy
 * (GDRIVE_PROXY_URL) nếu đã cấu hình — vì đây là cách ổn định nhất, giống hệt
 * cách trang mylibrary đang vận hành. Nếu không có proxy hoặc proxy lỗi,
 * fallback sang gọi thẳng Google Drive (kèm xử lý confirm-token).
 *
 * Trả về { buffer, contentType, contentLength, fileName } hoặc throw lỗi.
 */
export async function fetchDriveFile(fileIdOrLink) {
  const id = resolveDriveFileId(fileIdOrLink);
  if (!id) throw new Error("INVALID_DRIVE_FILE_ID");

  let lastErr = null;

  const proxyUrl = driveProxyUrl(id);
  if (proxyUrl) {
    try {
      const res = await fetchWithTimeout(proxyUrl);
      return await readResponseAsFile(res);
    } catch (err) {
      lastErr = err;
      // Rơi xuống fallback bên dưới thay vì throw ngay — proxy có thể tạm lỗi.
    }
  }

  for (const url of directDownloadCandidates(id)) {
    try {
      return await fetchDirectWithConfirm(url);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("DRIVE_FETCH_FAILED");
}

/**
 * Giống fetchDriveFile, nhưng trả về STREAM thay vì buffer toàn bộ file vào RAM.
 * Bắt buộc phải dùng cách này cho việc tải file sách/ảnh bìa qua Vercel Serverless
 * Functions, vì Vercel giới hạn response buffer thông thường ở mức 4.5MB — file
 * ebook (EPUB/PDF) rất dễ vượt ngưỡng này. Streaming response thì KHÔNG bị giới
 * hạn 4.5MB (xem https://vercel.com/docs/functions/limitations).
 *
 * Trả về { stream, contentType, contentLength, fileName } — `stream` là 1 Node.js
 * Readable, dùng `stream.pipe(res)` để đẩy thẳng ra client.
 */
export async function streamDriveFile(fileIdOrLink) {
  const id = resolveDriveFileId(fileIdOrLink);
  if (!id) throw new Error("INVALID_DRIVE_FILE_ID");

  let lastErr = null;

  const proxyUrl = driveProxyUrl(id);
  if (proxyUrl) {
    try {
      const res = await fetchWithTimeout(proxyUrl);
      if (!res.ok) throw new Error(`DRIVE_FETCH_FAILED_${res.status}`);
      return toStreamResult(res);
    } catch (err) {
      lastErr = err;
      // Proxy lỗi -> rơi xuống fallback gọi thẳng Google Drive bên dưới.
    }
  }

  for (const url of directDownloadCandidates(id)) {
    try {
      let res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`DRIVE_FETCH_FAILED_${res.status}`);
      const contentType = res.headers.get("content-type") || "";

      // Trang cảnh báo virus-scan của Drive luôn nhỏ (vài KB HTML) nên buffer
      // tạm thời phần này là an toàn — chỉ phần file thật mới cần streaming.
      if (contentType.includes("text/html")) {
        const html = await res.text();
        const tokenOrUrl = findConfirmToken(html);
        if (!tokenOrUrl) throw new Error("DRIVE_CONFIRM_TOKEN_NOT_FOUND");
        const nextUrl = tokenOrUrl.startsWith("http")
          ? tokenOrUrl.replace(/\\u0026/g, "&")
          : `${url}${url.includes("?") ? "&" : "?"}confirm=${tokenOrUrl}`;
        res = await fetchWithTimeout(nextUrl);
        if (!res.ok) throw new Error(`DRIVE_FETCH_FAILED_${res.status}`);
      }
      return toStreamResult(res);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("DRIVE_FETCH_FAILED");
}

function toStreamResult(res) {
  if (!res.body) throw new Error("DRIVE_EMPTY_BODY");
  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return {
    stream: Readable.fromWeb(res.body),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    contentLength: res.headers.get("content-length") || null,
    fileName: nameMatch ? decodeURIComponent(nameMatch[1].replace(/"/g, "")) : null,
  };
}

/** Map đuôi định dạng ebook sang MIME type chuẩn (dùng khi Drive không trả đúng content-type). */
export const FORMAT_MIME_TYPES = {
  EPUB: "application/epub+zip",
  PDF: "application/pdf",
  MOBI: "application/x-mobipocket-ebook",
  AZW3: "application/vnd.amazon.ebook",
  AZW: "application/vnd.amazon.ebook",
  FB2: "application/x-fictionbook+xml",
  CBZ: "application/vnd.comicbook+zip",
  CBR: "application/vnd.comicbook-rar",
  TXT: "text/plain",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** OPDS acquisition rel chuẩn cho link tải sách. */
export const OPDS_ACQUISITION_REL = "http://opds-spec.org/acquisition";
