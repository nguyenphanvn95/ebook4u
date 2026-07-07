// api/search.js — Acquisition feed: tìm theo title/author/series/tag/publisher, ?q=
import { getLibrary } from "../lib/cache.js";
import { searchBooks } from "../lib/metadata.js";
import { buildAcquisitionFeed, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { paginate, readPageParam } from "../lib/pagination.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const q = url.searchParams.get("q") || "";
  const page = readPageParam(url.searchParams);

  let xml;
  try {
    const lib = await getLibrary();
    const results = q ? searchBooks(lib.books, q) : [];
    const pagination = paginate(results, page);

    xml = buildAcquisitionFeed({
      id: `urn:opds-server:search:${encodeURIComponent(q)}`,
      title: q ? `Kết quả tìm kiếm: "${q}"` : "Tìm kiếm",
      baseUrl,
      pathWithQuery: `/api/search?q=${encodeURIComponent(q)}`,
      books: pagination.items,
      pagination,
      upHref: "/api/opds",
    });
  } catch (err) {
    console.log("[opds] /api/search lỗi:", err.message);
    xml = buildErrorFeed("Không thể thực hiện tìm kiếm.");
  }

  console.log("[opds] request time /api/search", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
