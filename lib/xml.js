// lib/xml.js
// Tiện ích escape XML và format ngày giờ chuẩn ATOM/OPDS.
// Không dùng thư viện XML builder ngoài để giữ dependency = 0.

/** Escape các ký tự đặc biệt XML. An toàn với Unicode (tiếng Việt). */
export function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Escape để dùng an toàn trong query string XML attribute. */
export function escapeAttr(value) {
  return escapeXml(value);
}

/** Chuyển timestamp (number | string | Date) sang ISO8601, fallback về epoch nếu invalid. */
export function toIsoDate(value) {
  if (!value) return new Date(0).toISOString();
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return new Date(0).toISOString();
  return d.toISOString();
}

/** Sinh id URN ổn định cho entry (Atom yêu cầu <id> duy nhất, không đổi). */
export function urnId(...parts) {
  return `urn:opds-server:${parts.map((p) => String(p)).join(":")}`;
}
