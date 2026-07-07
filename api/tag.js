// api/tag.js — Acquisition feed: sách theo 1 thể loại cụ thể, ?id=<tên tag>
import { getLibrary } from "../lib/cache.js";
import { buildAcquisitionFeed, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { paginate, readPageParam } from "../lib/pagination.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const tagId = url.searchParams.get("id") || "";
  const page = readPageParam(url.searchParams);

  let xml;
  try {
    const lib = await getLibrary();
    const books = lib.tagIndex.get(tagId) || [];
    const pagination = paginate(books, page);

    xml = buildAcquisitionFeed({
      id: `urn:opds-server:tag:${encodeURIComponent(tagId)}`,
      title: tagId ? `Thể loại: ${tagId}` : "Thể loại không xác định",
      baseUrl,
      pathWithQuery: `/api/tag?id=${encodeURIComponent(tagId)}`,
      books: pagination.items,
      pagination,
      upHref: "/api/tags",
    });
  } catch (err) {
    console.log("[opds] /api/tag lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải danh sách sách theo thể loại.");
  }

  console.log("[opds] request time /api/tag", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
