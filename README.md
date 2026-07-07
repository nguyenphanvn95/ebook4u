# OPDS Server cho Moon+ Reader (Vercel Serverless, Google Drive)

Một OPDS 1.x Content Server sinh XML động, **không dùng SQLite/Calibre/database**,
lấy toàn bộ dữ liệu từ **một file `metadata_public.json` public trên Google Drive**
(ví dụ file được một Google Apps Script tạo ra, tương tự cách trang
`nguyenphanvn95.github.io/mylibrary/` đang dùng để đọc dữ liệu Drive).

## 1. Cấu trúc dự án

```
/
├── api/            # mỗi file = 1 serverless function (Vercel tự route theo tên file)
│   ├── opds.js         GET /api/opds            catalog gốc
│   ├── authors.js      GET /api/authors         danh sách tác giả
│   ├── author.js       GET /api/author?id=      sách theo tác giả
│   ├── series.js       GET /api/series[?id=]    danh sách bộ sách / sách trong bộ
│   ├── tags.js         GET /api/tags            danh sách thể loại
│   ├── tag.js          GET /api/tag?id=         sách theo thể loại
│   ├── newest.js       GET /api/newest          sách mới nhập
│   ├── search.js       GET /api/search?q=       tìm kiếm
│   └── book.js         GET /api/book?id=        entry / tải file / ảnh bìa
├── lib/
│   ├── metadata.js     chuẩn hoá JSON thô + build index RAM
│   ├── cache.js        cache RAM 10 phút, fallback khi lỗi
│   ├── xml.js           escape XML, format ngày
│   ├── opds-builder.js  sinh XML Atom/OPDS
│   ├── gdrive.js        xử lý link Google Drive (xem mục 4)
│   └── pagination.js
├── public/opensearch.xml
├── config.js         toàn bộ hằng số cấu hình (METADATA_URL, cache TTL, page size...)
├── vercel.json
└── package.json
```

## 2. Cấu hình biến môi trường

Không hardcode URL trong code. Cấu hình qua biến môi trường trên Vercel:

Project Settings → Environment Variables → thêm:

| Key                | Value ví dụ                                                                 |
|--------------------|------------------------------------------------------------------------------|
| `METADATA_URL`     | URL public trả về JSON của `metadata_public.json`                            |
| `GDRIVE_PROXY_URL` | URL Web App Apps Script (`.../exec`) dùng để đọc file Drive — **khuyên dùng**, xem mục 4 |
| `CACHE_TTL_MS`     | `600000` (10 phút, tuỳ chọn)                                                  |
| `PAGE_SIZE`        | `100` (tuỳ chọn)                                                              |
| `CATALOG_TITLE`    | `Thư viện của tôi` (tuỳ chọn)                                                 |

`METADATA_URL` có thể là:

- **Link Google Apps Script Web App** (khuyên dùng — giống cách
  `nguyenphanvn95.github.io/mylibrary` đang làm): cùng 1 Web App ở mục 4 có
  thể vừa phục vụ `metadata_public.json` (khi gọi không kèm `?id=`) vừa phục
  vụ từng file lẻ (khi gọi kèm `?id=<file_id>`).
- **Link Google Drive trực tiếp tới file JSON**: chia sẻ file
  `metadata_public.json` ở chế độ "Anyone with the link", lấy File ID, rồi dùng
  `https://drive.google.com/uc?export=download&id=<FILE_ID>`.

## 3. Deploy lên Vercel

```bash
npm i -g vercel        # nếu chưa có
cd opds-vercel
vercel                 # link project lần đầu
vercel env add METADATA_URL production
vercel --prod
```

Hoặc: push code lên GitHub → Import project trong Vercel Dashboard → thêm
Environment Variable `METADATA_URL` → Deploy.

## 4. Google Apps Script Proxy — cơ chế thật của mylibrary

Đây là phần quan trọng nhất, học từ chính `app.js` của
`nguyenphanvn95.github.io/mylibrary`. Điểm mấu chốt: `metadata_public.json`
**không lưu URL**, mà chỉ lưu **`file_id` trần** của từng file trên Drive
(cover, epub, pdf...). Gọi thẳng `drive.google.com/uc?export=download&id=...`
từ code thường xuyên bị Google trả 403 / chặn anti-bot, hoặc chèn trang xác
nhận virus-scan với file lớn.

Giải pháp: 1 **Google Apps Script Web App** do chính bạn deploy, đọc file
bằng `DriveApp` **phía server** (không qua fetch), rồi trả thẳng byte:

```js
// Code.gs — deploy dạng Web App (Execute as: Me, Who has access: Anyone)
function doGet(e) {
  var id = e.parameter.id;
  if (!id) {
    return ContentService.createTextOutput('Missing id')
      .setMimeType(ContentService.MimeType.TEXT);
  }
  try {
    var file = DriveApp.getFileById(id);
    return file.getBlob(); // Apps Script tự trả đúng Content-Type của file
  } catch (err) {
    return ContentService.createTextOutput('Error: ' + err.message)
      .setMimeType(ContentService.MimeType.TEXT);
  }
}
```

Deploy: **Extensions → Apps Script** trong 1 Google Sheet/Doc bất kỳ (hoặc
script.google.com độc lập) → dán code trên → **Deploy → New deployment →
Web app** → Execute as **Me**, Who has access **Anyone** → Deploy → copy URL
dạng `https://script.google.com/macros/s/XXXXX/exec`.

Dán URL đó vào biến môi trường `GDRIVE_PROXY_URL` trên Vercel.

**Cách `lib/gdrive.js` dùng URL này** (đúng thứ tự ưu tiên như `driveFetch()`
trong `app.js` gốc):

1. Nếu đã cấu hình `GDRIVE_PROXY_URL` → gọi
   `${GDRIVE_PROXY_URL}?id=<file_id>` trước tiên. Đây là cách ổn định nhất.
2. Nếu không có proxy, hoặc proxy lỗi → fallback gọi thẳng
   `https://drive.google.com/uc?export=download&id=<file_id>` và
   `https://drive.usercontent.google.com/download?id=<file_id>&export=download&confirm=t`,
   tự động bóc `confirm token` nếu Google trả về trang HTML cảnh báo virus-scan
   thay vì file.
3. `/api/book?id=...&download=EPUB` và `&cover=1` luôn **proxy byte qua chính
   server của bạn** (không redirect thẳng client sang Drive), kèm đúng
   `Content-Type` / `Content-Disposition`, để Moon+ Reader luôn nhận đúng file.
4. Riêng ảnh **thumbnail** trong feed (`rel="...image/thumbnail"`) trỏ thẳng
   tới endpoint công khai `drive.google.com/thumbnail?id=...&sz=w300` — nhẹ,
   nhanh, client (Moon+ Reader) tự tải thẳng từ Google, không tốn băng thông
   server của bạn.

> Lưu ý: Apps Script Web App có giới hạn thời gian chạy (~6 phút) và quota
> hằng ngày theo tài khoản Google — phù hợp cho thư viện cá nhân/nhóm nhỏ.
> Với thư viện rất lớn hoặc nhiều người dùng đồng thời, cân nhắc lưu trữ
> chuyên dụng hơn (R2, S3, Backblaze B2...).

## 5. Test với Moon+ Reader

1. Mở Moon+ Reader → **Library** → nút **+** (thêm thư viện) → **OPDS Catalogs**.
2. Thêm catalog mới, nhập URL: `https://<ten-du-an>.vercel.app/api/opds`.
3. Moon+ Reader sẽ hiển thị các mục điều hướng: Mới nhập, Theo tác giả, Theo bộ
   sách, Theo thể loại. Chạm vào để duyệt, chạm vào 1 cuốn sách để tải trực tiếp.
4. Dùng thanh tìm kiếm trong Moon+ Reader (nếu client hỗ trợ OpenSearch) để gọi
   `/api/search?q=`.

## 6. Ví dụ endpoint

```
GET /api/opds
GET /api/authors
GET /api/author?id=Nguy%E1%BB%85n%20Nh%E1%BA%ADt%20%C3%81nh
GET /api/series
GET /api/series?id=Kính%20Vạn%20Hoa
GET /api/tags
GET /api/tag?id=Ti%E1%BB%83u%20thuy%E1%BA%BFt
GET /api/newest?page=2
GET /api/search?q=harry%20potter
GET /api/book?id=123
GET /api/book?id=123&download=EPUB
GET /api/book?id=123&cover=1
```

## 7. Ví dụ OPDS trả về (rút gọn)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:opds-server:root</id>
  <title>Thư viện OPDS của tôi</title>
  <updated>2026-07-07T10:00:00.000Z</updated>
  <link rel="self" href="https://your-app.vercel.app/api/opds" type="application/atom+xml;profile=opds-catalog;charset=utf-8"/>
  <entry>
    <id>urn:opds-server:newest</id>
    <title>📚 Mới nhập gần đây</title>
    <link rel="subsection" href="https://your-app.vercel.app/api/newest" .../>
  </entry>
  ...
</feed>
```

## 8. Schema `metadata_public.json` được hỗ trợ

Đây là schema **thật** (học từ `app.js` của mylibrary), không phải mảng mà là
**object khoá theo `book_id`**. Cũng chấp nhận dạng bọc `{ "books": { ... } }`
để tương thích ngược. Mọi trường đều optional — thiếu trường nào cũng không
crash:

```json
{
  "23": {
    "book_id": 23,
    "title": "Kính Vạn Hoa - Tập 1",
    "author_sort": "Nguyen, Nhat Anh",
    "authors": "Nguyễn Nhật Ánh, Tác giả B",
    "series": "Kính Vạn Hoa",
    "series_index": 1,
    "tags": ["Thiếu nhi", "Việt Nam"],
    "publisher": "NXB Trẻ",
    "rating": 9,
    "comments": "<p>Mô tả sách dạng <b>HTML</b>...</p>",
    "timestamp": "2024-05-01T00:00:00Z",
    "pubdate": "2002-01-01",
    "languages": ["vie"],
    "has_cover": true,
    "cover": { "file_id": "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567" },
    "formats": {
      "EPUB": { "file_id": "1XyZ11111111111111111111111111111" },
      "PDF":  { "file_id": "1QwE22222222222222222222222222222" }
    },
    "metadata_opf": { "file_id": "1Opf33333333333333333333333333333" }
  },
  "45": { "...": "..." }
}
```

Ghi chú xử lý:

- `authors` là **chuỗi** (nhiều tác giả nối bằng dấu phẩy), không phải mảng —
  `lib/metadata.js` tự tách thành mảng.
- `tags`/`languages` chấp nhận cả mảng lẫn chuỗi phân tách dấu phẩy.
- `formats`/`cover`/`metadata_opf` chỉ chứa **`file_id` trần** (hoặc, để tương
  thích ngược, 1 URL Drive đầy đủ) — không chứa link tải sẵn.
- `rating` theo thang Calibre 0-10 (2 điểm/sao); được tự quy đổi sang 0-5 khi
  hiển thị trong `<dc:rating>`.
- `timestamp` (ngày **nhập** vào thư viện) được ưu tiên để sắp xếp "Mới nhập
  gần đây"; nếu thiếu, `date_added`/`added`/`import_date` cũng được chấp nhận;
  nếu tất cả đều thiếu, sách có `book_id` lớn hơn coi như nhập sau.
- `metadata_opf` (file `.opf` chứa mô tả/metadata bổ sung dạng Dublin Core) —
  hiện được lưu lại trong index (`book.metadataOpfId`) nhưng chưa có endpoint
  nào tự động đọc/parse XML này; đây là điểm có thể mở rộng thêm sau này nếu
  cần fallback mô tả khi `comments` trống, giống cách `app.js` gốc làm.

