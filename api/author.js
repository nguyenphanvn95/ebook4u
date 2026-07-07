// api/author.js — Acquisition feed: sách của 1 tác giả cụ thể, ?id=<tên tác giả>
import { getLibrary } from "../lib/cache.js";
import { buildAcquisitionFeed, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { paginate, readPageParam } from "../lib/pagination.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const authorId = url.searchParams.get("id") || "";
  const page = readPageParam(url.searchParams);

  let xml;
  try {
    const lib = await getLibrary();
    const books = lib.authorIndex.get(authorId) || [];
    const pagination = paginate(books, page);

    xml = buildAcquisitionFeed({
      id: `urn:opds-server:author:${encodeURIComponent(authorId)}`,
      title: authorId ? `Sách của ${authorId}` : "Tác giả không xác định",
      baseUrl,
      pathWithQuery: `/api/author?id=${encodeURIComponent(authorId)}`,
      books: pagination.items,
      pagination,
      upHref: "/api/authors",
    });
  } catch (err) {
    console.log("[opds] /api/author lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải danh sách sách theo tác giả.");
  }

  console.log("[opds] request time /api/author", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
