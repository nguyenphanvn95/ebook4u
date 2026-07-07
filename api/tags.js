// api/tags.js — Navigation feed: danh sách tất cả thể loại (tags).
import { getLibrary } from "../lib/cache.js";
import { buildNavigationFeed, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  let xml;

  try {
    const lib = await getLibrary();
    const tags = [...lib.tagIndex.keys()].sort((a, b) => a.localeCompare(b, "vi"));

    xml = buildNavigationFeed({
      id: "urn:opds-server:tags",
      title: "Thể loại",
      baseUrl,
      selfHref: "/api/tags",
      upHref: "/api/opds",
      entries: tags.map((tag) => ({
        id: `urn:opds-server:tag:${encodeURIComponent(tag)}`,
        title: tag,
        href: `/api/tag?id=${encodeURIComponent(tag)}`,
        content: `${lib.tagIndex.get(tag).length} cuốn sách`,
      })),
    });
  } catch (err) {
    console.log("[opds] /api/tags lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải danh sách thể loại.");
  }

  console.log("[opds] request time /api/tags", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
