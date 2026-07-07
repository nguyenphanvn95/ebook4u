// lib/opds-builder.js
//
// Sinh XML Atom/OPDS 1.x động. Không dùng thư viện XML builder ngoài —
// template string là đủ và dễ kiểm soát format cho chuẩn OPDS.

import { escapeXml, toIsoDate, urnId } from "./xml.js";
import { CATALOG_TITLE, CATALOG_AUTHOR, CATALOG_ID } from "../config.js";
import {
  driveDirectDownloadUrl,
  driveThumbnailUrl,
  FORMAT_MIME_TYPES,
  OPDS_ACQUISITION_REL,
} from "./gdrive.js";

/** Loại bỏ thẻ HTML thô trong "comments" (Calibre xuất HTML) để dùng cho <summary> dạng text. */
function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REL = {
  self: "self",
  start: "start",
  up: "up",
  first: "first",
  previous: "previous",
  next: "next",
  last: "last",
  search: "search",
  subsection: "subsection",
  image: "http://opds-spec.org/image",
  thumbnail: "http://opds-spec.org/image/thumbnail",
};

/** Xác định origin (scheme+host) từ request để sinh absolute URL trong feed. */
export function getBaseUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${forwardedProto}://${host}`;
}

function link(rel, href, type = "application/atom+xml;profile=opds-catalog;charset=utf-8", extra = "") {
  return `<link rel="${escapeXml(rel)}" href="${escapeXml(href)}" type="${escapeXml(type)}"${
    extra ? " " + extra : ""
  }/>`;
}

function feedOpenTag() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">`;
}

/** Header chung của mọi feed: id, title, updated, author, link self/start. */
function feedHeader({ id, title, baseUrl, selfHref, upHref, searchHref }) {
  const parts = [
    `<id>${escapeXml(id)}</id>`,
    `<title>${escapeXml(title)}</title>`,
    `<updated>${toIsoDate(new Date())}</updated>`,
    `<author><name>${escapeXml(CATALOG_AUTHOR)}</name></author>`,
    link(REL.self, `${baseUrl}${selfHref}`),
    link(REL.start, `${baseUrl}/api/opds`),
  ];
  if (upHref) parts.push(link(REL.up, `${baseUrl}${upHref}`));
  if (searchHref) {
    parts.push(
      link(
        REL.search,
        `${baseUrl}${searchHref}`,
        "application/opensearchdescription+xml"
      )
    );
  }
  return parts.join("\n  ");
}

/** Sinh các link phân trang first/previous/next/last dựa trên path gốc (không kèm page). */
function paginationLinks(baseUrl, pathWithQuery, pagination) {
  const withPage = (p) => {
    const url = new URL(`${baseUrl}${pathWithQuery}`);
    url.searchParams.set("page", String(p));
    return url.pathname + url.search;
  };
  const parts = [];
  parts.push(link(REL.first, `${baseUrl}${withPage(1)}`));
  if (pagination.hasPrevious) parts.push(link(REL.previous, `${baseUrl}${withPage(pagination.page - 1)}`));
  if (pagination.hasNext) parts.push(link(REL.next, `${baseUrl}${withPage(pagination.page + 1)}`));
  parts.push(link(REL.last, `${baseUrl}${withPage(pagination.totalPages)}`));
  return parts.join("\n  ");
}

/**
 * Feed điều hướng (navigation feed): dùng cho /api/opds gốc, /api/authors, /api/tags, /api/series (list).
 * entries: [{ id, title, href, content }]
 */
export function buildNavigationFeed({ id, title, baseUrl, selfHref, entries, upHref, searchHref }) {
  const entriesXml = entries
    .map(
      (e) => `<entry>
    <id>${escapeXml(e.id)}</id>
    <title>${escapeXml(e.title)}</title>
    <updated>${toIsoDate(new Date())}</updated>
    ${e.content ? `<content type="text">${escapeXml(e.content)}</content>` : ""}
    ${link(REL.subsection, `${baseUrl}${e.href}`)}
  </entry>`
    )
    .join("\n  ");

  return `${feedOpenTag()}
  ${feedHeader({ id, title, baseUrl, selfHref, upHref, searchHref })}
  ${entriesXml}
</feed>`;
}

/** Sinh 1 <entry> đầy đủ cho một cuốn sách, bao gồm acquisition links và cover/thumbnail. */
export function buildBookEntry(book, baseUrl) {
  const authorsXml = book.authors.map((a) => `<author><name>${escapeXml(a)}</name></author>`).join("");

  const categoriesXml = book.tags
    .map((t) => `<category term="${escapeXml(t)}" label="${escapeXml(t)}"/>`)
    .join("");

  const acquisitionLinks = book.formats
    .map((f) => {
      const mime = FORMAT_MIME_TYPES[f.format] || "application/octet-stream";
      // Trỏ về endpoint của chính server (proxy) thay vì thẳng Google Drive,
      // để đảm bảo luôn trả đúng bytes file + xử lý được file lớn bị chặn virus-scan.
      const href = `${baseUrl}/api/book?id=${encodeURIComponent(book.id)}&download=${encodeURIComponent(
        f.format
      )}`;
      return link(OPDS_ACQUISITION_REL, href, mime);
    })
    .join("\n    ");

  const coverLinks = book.hasCover && book.coverId
    ? [
        link(REL.image, `${baseUrl}/api/book?id=${encodeURIComponent(book.id)}&cover=1`, "image/jpeg"),
        link(REL.thumbnail, driveThumbnailUrl(book.coverId, 300), "image/jpeg"),
      ].join("\n    ")
    : "";

  const dcFields = [
    book.publisher ? `<dc:publisher>${escapeXml(book.publisher)}</dc:publisher>` : "",
    book.languages.length ? `<dc:language>${escapeXml(book.languages[0])}</dc:language>` : "",
    // rating lưu thang Calibre 0-10; quy đổi ra 0-5 sao cho dc:rating chuẩn OPDS.
    book.rating !== null ? `<dc:rating>${escapeXml((book.rating / 2).toFixed(1))}</dc:rating>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  const seriesField = book.series
    ? `<dc:extent>${escapeXml(book.series)}${
        book.seriesIndex !== null ? " #" + escapeXml(book.seriesIndex) : ""
      }</dc:extent>`
    : "";

  const plainComments = book.comments ? stripHtml(book.comments) : "";

  return `<entry>
    <id>${urnId("book", book.id)}</id>
    <title>${escapeXml(book.title)}</title>
    <updated>${toIsoDate(book.timestamp || book.pubdate)}</updated>
    ${authorsXml}
    ${categoriesXml}
    ${dcFields}
    ${seriesField}
    ${plainComments ? `<summary type="text">${escapeXml(plainComments.slice(0, 2000))}</summary>` : ""}
    <content type="text">${escapeXml(plainComments ? plainComments.slice(0, 500) : book.title)}</content>
    ${acquisitionLinks}
    ${coverLinks}
  </entry>`;
}

/**
 * Feed danh sách sách (acquisition feed) có phân trang: /api/author, /api/tag,
 * /api/series (khi có id), /api/newest, /api/search.
 */
export function buildAcquisitionFeed({
  id,
  title,
  baseUrl,
  pathWithQuery,
  books,
  pagination,
  upHref = "/api/opds",
}) {
  const entriesXml = books.map((b) => buildBookEntry(b, baseUrl)).join("\n  ");
  const pagLinks = paginationLinks(baseUrl, pathWithQuery, pagination);
  const selfWithPage = (() => {
    const url = new URL(`${baseUrl}${pathWithQuery}`);
    url.searchParams.set("page", String(pagination.page));
    return url.pathname + url.search;
  })();

  return `${feedOpenTag()}
  ${feedHeader({ id, title, baseUrl, selfHref: selfWithPage, upHref })}
  ${pagLinks}
  <opds:totalResults>${pagination.totalItems}</opds:totalResults>
  <opds:itemsPerPage>${pagination.pageSize}</opds:itemsPerPage>
  ${entriesXml}
</feed>`;
}

/** Feed lỗi hợp lệ về mặt XML/OPDS — dùng khi chưa có cache và tải metadata thất bại. */
export function buildErrorFeed(message) {
  return `${feedOpenTag()}
  <id>${CATALOG_ID}:error</id>
  <title>${escapeXml(CATALOG_TITLE)} - Lỗi</title>
  <updated>${toIsoDate(new Date())}</updated>
  <author><name>${escapeXml(CATALOG_AUTHOR)}</name></author>
  <entry>
    <id>urn:opds-server:error</id>
    <title>Không thể tải dữ liệu thư viện</title>
    <updated>${toIsoDate(new Date())}</updated>
    <content type="text">${escapeXml(message)}</content>
  </entry>
</feed>`;
}

/** Single-entry OPDS document dùng cho /api/book?id= (không kèm download/cover). */
export function buildSingleBookEntryDocument(book, baseUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">
${buildBookEntry(book, baseUrl).replace(/^<entry>|<\/entry>$/g, "")}
</entry>`;
}

export { CATALOG_TITLE, CATALOG_ID };
