// api/series.js
// - Không có query "id": trả navigation feed danh sách tất cả bộ sách.
// - Có query "id": trả acquisition feed các sách trong bộ sách đó (đã sort theo series_index).
import { getLibrary } from "../lib/cache.js";
import {
  buildNavigationFeed,
  buildAcquisitionFeed,
  buildErrorFeed,
  getBaseUrl,
} from "../lib/opds-builder.js";
import { paginate, readPageParam } from "../lib/pagination.js";
import { OPDS_CONTENT_TYPE } from "../config.js";

export default async function handler(req, res) {
  const start = Date.now();
  const baseUrl = getBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const seriesId = url.searchParams.get("id");
  const page = readPageParam(url.searchParams);

  let xml;
  try {
    const lib = await getLibrary();

    if (seriesId) {
      const books = lib.seriesIndex.get(seriesId) || [];
      const pagination = paginate(books, page);
      xml = buildAcquisitionFeed({
        id: `urn:opds-server:series:${encodeURIComponent(seriesId)}`,
        title: `Bộ sách: ${seriesId}`,
        baseUrl,
        pathWithQuery: `/api/series?id=${encodeURIComponent(seriesId)}`,
        books: pagination.items,
        pagination,
        upHref: "/api/series",
      });
    } else {
      const seriesNames = [...lib.seriesIndex.keys()].sort((a, b) => a.localeCompare(b, "vi"));
      xml = buildNavigationFeed({
        id: "urn:opds-server:series",
        title: "Bộ sách",
        baseUrl,
        selfHref: "/api/series",
        upHref: "/api/opds",
        entries: seriesNames.map((name) => ({
          id: `urn:opds-server:series:${encodeURIComponent(name)}`,
          title: name,
          href: `/api/series?id=${encodeURIComponent(name)}`,
          content: `${lib.seriesIndex.get(name).length} cuốn sách`,
        })),
      });
    }
  } catch (err) {
    console.log("[opds] /api/series lỗi:", err.message);
    xml = buildErrorFeed("Không thể tải dữ liệu bộ sách.");
  }

  console.log("[opds] request time /api/series", `${Date.now() - start}ms`);
  res.setHeader("Content-Type", OPDS_CONTENT_TYPE);
  res.status(200).send(xml);
}
