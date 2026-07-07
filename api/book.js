// api/book.js
//
// Ba chức năng gộp trong 1 endpoint (theo id sách):
//   GET /api/book?id=<id>                       -> OPDS <entry> đầy đủ metadata
//   GET /api/book?id=<id>&download=<FORMAT>      -> proxy tải file thật (epub/pdf/...) từ Google Drive
//   GET /api/book?id=<id>&cover=1                -> proxy ảnh bìa full-size từ Google Drive
//
// Việc proxy (thay vì redirect thẳng sang drive.google.com) là bắt buộc để:
//   - Vượt qua trang cảnh báo virus-scan của Google với file lớn.
//   - Đảm bảo Content-Type / Content-Disposition đúng, để Moon+ Reader nhận diện
//     đúng định dạng file (.epub, .pdf, ...) thay vì tải về 1 trang HTML.

import { getLibrary } from "../lib/cache.js";
import { buildSingleBookEntryDocument, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { fetchDriveFile, FORMAT_MIME_TYPES } from "../lib/gdrive.js";
import { OPDS_ENTRY_CONTENT_TYPE } from "../config.js";

function safeFileName(title, format) {
  const base = String(title || "book")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 120);
  return `${base}.${String(format).toLowerCase()}`;
}

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const bookId = url.searchParams.get("id");
  const downloadFormat = url.searchParams.get("download");
  const wantCover = url.searchParams.get("cover") === "1";

  let lib;
  try {
    lib = await getLibrary();
  } catch (err) {
    console.log("[opds] /api/book lỗi tải thư viện:", err.message);
    res.setHeader("Content-Type", OPDS_ENTRY_CONTENT_TYPE);
    res.status(503).send(buildErrorFeed("Không thể tải metadata từ Google Drive."));
    return;
  }

  const book = bookId ? lib.idIndex.get(bookId) : null;
  if (!book) {
    res.setHeader("Content-Type", OPDS_ENTRY_CONTENT_TYPE);
    res.status(404).send(buildErrorFeed("Không tìm thấy sách với id đã cho."));
    return;
  }

  // --- Proxy tải ảnh bìa full-size ---
  if (wantCover) {
    if (!book.coverId) {
      res.status(404).send("Sách này không có ảnh bìa.");
      return;
    }
    try {
      const file = await fetchDriveFile(book.coverId);
      res.setHeader("Content-Type", file.contentType.startsWith("image/") ? file.contentType : "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.status(200).send(file.buffer);
    } catch (err) {
      console.log("[opds] lỗi tải cover:", err.message);
      res.status(502).send("Không thể tải ảnh bìa từ Google Drive.");
    }
    console.log("[opds] request time /api/book (cover)", `${Date.now() - start}ms`);
    return;
  }

  // --- Proxy tải file sách thật (epub/pdf/...) ---
  if (downloadFormat) {
    const fmt = book.formats.find((f) => f.format.toUpperCase() === downloadFormat.toUpperCase());
    if (!fmt) {
      res.status(404).send(`Sách không có định dạng ${downloadFormat}.`);
      return;
    }
    try {
      const file = await fetchDriveFile(fmt.driveId);
      const mime = FORMAT_MIME_TYPES[fmt.format] || file.contentType || "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFileName(book.title, fmt.format)}"`
      );
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.status(200).send(file.buffer);
    } catch (err) {
      console.log("[opds] lỗi tải file sách:", err.message);
      res.status(502).send("Không thể tải file sách từ Google Drive. File có thể quá lớn hoặc không public.");
    }
    console.log("[opds] request time /api/book (download)", `${Date.now() - start}ms`);
    return;
  }

  // --- Mặc định: trả OPDS entry metadata ---
  const xml = buildSingleBookEntryDocument(book, baseUrl);
  res.setHeader("Content-Type", OPDS_ENTRY_CONTENT_TYPE);
  res.status(200).send(xml);
  console.log("[opds] request time /api/book (entry)", `${Date.now() - start}ms`);
}
