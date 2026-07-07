// lib/metadata.js
//
// Đọc metadata_public.json (nguồn dữ liệu duy nhất), chuẩn hoá từng bản ghi
// sách về 1 shape thống nhất, rồi xây các index trong RAM.
//
// Schema thực tế của metadata_public.json (giống cấu trúc mà Calibre +
// Apps Script của trang mylibrary xuất ra) là 1 OBJECT khoá theo book_id,
// KHÔNG phải mảng:
//
//   {
//     "23": {
//       "book_id": 23,
//       "title": "...",
//       "author_sort": "Nguyen, Nhat Anh",
//       "authors": "Nguyễn Nhật Ánh",        // chuỗi, có thể nhiều tác giả nối bằng dấu phẩy
//       "tags": ["Thiếu nhi", "Việt Nam"],    // hoặc chuỗi "Thiếu nhi,Việt Nam"
//       "languages": ["vie"],                 // hoặc chuỗi "vie"
//       "pubdate": "2020-01-01",
//       "timestamp": "2020-01-01T00:00:00Z",  // ngày NHẬP vào thư viện
//       "has_cover": true,
//       "cover": { "file_id": "1AbC..." },
//       "series_index": 1,
//       "publisher": "NXB Trẻ",
//       "series": "Kính Vạn Hoa",
//       "formats": {
//         "EPUB": { "file_id": "1XyZ..." },
//         "PDF":  { "file_id": "1QwE..." }
//       },
//       "rating": 8,                           // thang Calibre 0-10 (2 điểm/sao)
//       "comments": "<p>Mô tả HTML...</p>",
//       "metadata_opf": { "file_id": "1Opf..." } // optional, fallback mô tả
//     },
//     "45": { ... }
//   }
//
// Cũng chấp nhận dạng bọc { "books": { "23": {...} } } để tương thích ngược.
// Thiếu trường nào cũng không được crash.

import { resolveDriveFileId } from "./gdrive.js";

/** Chuẩn hoá "tags"/"languages" vốn có thể là mảng hoặc chuỗi phân tách dấu phẩy. */
function toStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Rating Calibre lưu thang 0-10 (2 điểm/sao); tolerate luôn input 0-5. */
function normalizeCalibreRating(r) {
  if (r === null || r === undefined || r === "") return null;
  const n = Number(r);
  if (Number.isNaN(n)) return null;
  return n <= 5 ? n * 2 : n; // luôn trả về thang 0-10 để nhất quán
}

/**
 * Chuẩn hoá "formats": object { FORMAT: { file_id } | "file_id_or_url" }
 * -> mảng [{ format, driveId }]. Bỏ qua entry không trích được file_id.
 */
function normalizeFormats(formats) {
  const result = [];
  if (!formats || typeof formats !== "object") return result;

  for (const [formatName, value] of Object.entries(formats)) {
    let raw = null;
    if (typeof value === "string") raw = value;
    else if (value && typeof value === "object") raw = value.file_id || value.id || value.url;

    const driveId = raw ? resolveDriveFileId(String(raw)) : null;
    if (driveId) {
      result.push({ format: String(formatName || "UNKNOWN").toUpperCase(), driveId });
    }
  }
  return result;
}

/** Chuẩn hoá "cover": { file_id } | "file_id_or_url" -> driveId | null. */
function normalizeCoverId(cover) {
  if (!cover) return null;
  if (typeof cover === "string") return resolveDriveFileId(cover);
  if (typeof cover === "object") {
    const raw = cover.file_id || cover.id || cover.url;
    return raw ? resolveDriveFileId(String(raw)) : null;
  }
  return null;
}

/** Chuẩn hoá 1 bản ghi sách thô từ JSON về Book object đầy đủ, an toàn với field thiếu. */
function normalizeBook(raw, key) {
  const id = String(raw.book_id ?? raw.id ?? key);

  const authorsStr = raw.authors ? String(raw.authors) : "";
  const authors = authorsStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    id,
    uuid: raw.uuid ? String(raw.uuid) : id,
    title: raw.title ? String(raw.title) : "(Không có tiêu đề)",
    authorSort: raw.author_sort ? String(raw.author_sort) : authorsStr,
    authors: authors.length ? authors : ["Unknown"],
    series: raw.series ? String(raw.series) : null,
    seriesIndex:
      raw.series_index !== undefined && raw.series_index !== null
        ? Number(raw.series_index) || 0
        : null,
    tags: toStringArray(raw.tags),
    publisher: raw.publisher ? String(raw.publisher) : null,
    // Giữ nguyên thang điểm 0-10 kiểu Calibre; chia 2 khi hiển thị dạng sao.
    rating: normalizeCalibreRating(raw.rating),
    comments: raw.comments ? String(raw.comments) : null,
    // Ngày NHẬP vào thư viện (để sort "mới nhất") — chấp nhận vài tên trường phổ biến.
    timestamp: raw.timestamp || raw.date_added || raw.added || raw.import_date || null,
    pubdate: raw.pubdate || null,
    languages: toStringArray(raw.languages),
    coverId: normalizeCoverId(raw.cover),
    hasCover: raw.has_cover !== undefined ? !!raw.has_cover : !!normalizeCoverId(raw.cover),
    formats: normalizeFormats(raw.formats),
    // File OPF dự phòng (mô tả/metadata bổ sung) — chưa được các endpoint dùng
    // tới, giữ lại để dễ mở rộng về sau nếu cần đọc thêm metadata.opf.
    metadataOpfId: raw.metadata_opf ? normalizeCoverId(raw.metadata_opf) : null,
  };
}

/** Trích danh sách [key, rawBookEntry] bất kể input là object-keyed-by-id hay mảng hay bọc trong "books". */
function extractRawEntries(rawJson) {
  const container = rawJson?.books || rawJson?.data || rawJson;

  if (Array.isArray(container)) {
    return container.map((entry, i) => [String(entry?.book_id ?? entry?.id ?? i), entry]);
  }
  if (container && typeof container === "object") {
    return Object.entries(container);
  }
  return [];
}

/**
 * Chuyển JSON thô thành:
 *  { books: Book[], idIndex, authorIndex, tagIndex, seriesIndex, newestSorted }
 */
export function buildLibraryIndex(rawJson) {
  const rawEntries = extractRawEntries(rawJson);

  const books = rawEntries.map(([key, raw]) => {
    try {
      return normalizeBook(raw || {}, key);
    } catch {
      // Không bao giờ để 1 bản ghi lỗi làm crash toàn bộ danh sách.
      return normalizeBook({}, key);
    }
  });

  const idIndex = new Map();
  const authorIndex = new Map(); // authorName -> Book[]
  const tagIndex = new Map(); // tagName -> Book[]
  const seriesIndex = new Map(); // seriesName -> Book[]

  for (const book of books) {
    idIndex.set(book.id, book);

    for (const author of book.authors) {
      if (!authorIndex.has(author)) authorIndex.set(author, []);
      authorIndex.get(author).push(book);
    }

    for (const tag of book.tags) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, []);
      tagIndex.get(tag).push(book);
    }

    if (book.series) {
      if (!seriesIndex.has(book.series)) seriesIndex.set(book.series, []);
      seriesIndex.get(book.series).push(book);
    }
  }

  // Sắp xếp sách trong từng series theo series_index tăng dần.
  for (const list of seriesIndex.values()) {
    list.sort((a, b) => (a.seriesIndex || 0) - (b.seriesIndex || 0));
  }

  // "Mới nhất" ưu tiên theo timestamp (ngày nhập); nếu thiếu, id lớn hơn coi
  // như nhập sau (đúng cách Calibre cấp id tăng dần) — giống logic của mylibrary.
  const newestSorted = [...books].sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return String(b.timestamp).localeCompare(String(a.timestamp));
    }
    if (a.timestamp && !b.timestamp) return -1;
    if (!a.timestamp && b.timestamp) return 1;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });

  return { books, idIndex, authorIndex, tagIndex, seriesIndex, newestSorted };
}

/** Tìm kiếm không phân biệt hoa/thường, hỗ trợ Unicode (kể cả gõ không dấu tiếng Việt). */
export function searchBooks(books, query) {
  const q = normalizeSearchText(query);
  if (!q) return [];
  return books.filter((book) => {
    const haystack = normalizeSearchText(
      [
        book.title,
        book.authors.join(" "),
        book.series || "",
        book.tags.join(" "),
        book.publisher || "",
      ].join(" ")
    );
    return haystack.includes(q);
  });
}

// Bỏ dấu tiếng Việt + viết thường, cho phép tìm "nguyen nhat anh" ra
// "Nguyễn Nhật Ánh" — giống hệt cách mylibrary/app.js xử lý tìm kiếm không dấu.
function normalizeSearchText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
