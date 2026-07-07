// api/authors.js — Navigation feed: danh sách tất cả tác giả (A→Z).
import { getLibrary } from "../lib/cache.js";
import { buildNavigationFeed, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  let xml;

  try {
    const lib = await getLibrary();
    const authors = [...lib.authorIndex.keys()].sort((a, b) => a.localeCompare(b, "vi"));

    xml = buildNavigationFeed({
      id: "urn:opds-server:authors",
      title: "Tác giả",
      baseUrl,
      selfHref: "/api/authors",
      upHref: "/api/opds",
      entries: authors.map((author) => ({
        id: `urn:opds-server:author:${encodeURIComponent(author)}`,
        title: author,
        href: `/api/author?id=${encodeURIComponent(author)}`,
        content: `${lib.authorIndex.get(author).length} cuốn sách`,
      })),
    });
  } catch (err) {
    console.log("[opds] /api/authors lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải danh sách tác giả.");
  }

  console.log("[opds] request time /api/authors", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
