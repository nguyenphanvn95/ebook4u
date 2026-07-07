// api/opds.js — Catalog gốc (root navigation feed).
import { getLibrary } from "../lib/cache.js";
import { buildNavigationFeed, buildErrorFeed, CATALOG_ID, CATALOG_TITLE } from "../lib/opds-builder.js";
import { getBaseUrl } from "../lib/opds-builder.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);

  let xml;
  try {
    const lib = await getLibrary();
    xml = buildNavigationFeed({
      id: CATALOG_ID,
      title: CATALOG_TITLE,
      baseUrl,
      selfHref: "/api/opds",
      searchHref: "/opensearch.xml",
      entries: [
        {
          id: "urn:opds-server:newest",
          title: "📚 Mới nhập gần đây",
          href: "/api/newest",
          content: `${lib.books.length} cuốn sách trong thư viện`,
        },
        {
          id: "urn:opds-server:authors",
          title: "✍️ Theo tác giả",
          href: "/api/authors",
          content: `${lib.authorIndex.size} tác giả`,
        },
        {
          id: "urn:opds-server:series",
          title: "📖 Theo bộ sách",
          href: "/api/series",
          content: `${lib.seriesIndex.size} bộ sách`,
        },
        {
          id: "urn:opds-server:tags",
          title: "🏷️ Theo thể loại",
          href: "/api/tags",
          content: `${lib.tagIndex.size} thể loại`,
        },
      ],
    });
  } catch (err) {
    console.log("[opds] /api/opds lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải metadata từ Google Drive. Vui lòng thử lại sau.");
  }

  console.log("[opds] request time /api/opds", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
