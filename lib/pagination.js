// lib/pagination.js
import { PAGE_SIZE } from "../config.js";

/**
 * Cắt trang từ một mảng đã có sẵn (không filter lại, chỉ slice theo index).
 * @param {Array} items - danh sách đầy đủ (đã lọc/sắp xếp từ trước)
 * @param {number} page - trang hiện tại, bắt đầu từ 1
 * @param {number} pageSize
 */
export function paginate(items, page = 1, pageSize = PAGE_SIZE) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    items: pageItems,
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrevious: safePage > 1,
  };
}

/** Đọc & validate query param "page" từ URLSearchParams. */
export function readPageParam(searchParams) {
  const raw = parseInt(searchParams.get("page") || "1", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
