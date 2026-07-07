// api/newest.js — Acquisition feed: sách mới nhất theo timestamp/pubdate giảm dần.
import { getLibrary } from "../lib/cache.js";
import { buildAcquisitionFeed, buildErrorFeed, getBaseUrl } from "../lib/opds-builder.js";
import { paginate, readPageParam } from "../lib/pagination.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const page = readPageParam(url.searchParams);

  let xml;
  try {
    const lib = await getLibrary();
    const pagination = paginate(lib.newestSorted, page);

    xml = buildAcquisitionFeed({
      id: "urn:opds-server:newest",
      title: "Mới nhập gần đây",
      baseUrl,
      pathWithQuery: "/api/newest",
      books: pagination.items,
      pagination,
      upHref: "/api/opds",
    });
  } catch (err) {
    console.log("[opds] /api/newest lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải danh sách sách mới nhập.");
  }

  console.log("[opds] request time /api/newest", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
