# Giao thông Việt Nam · WebGIS

Bộ khung WebGIS điều hướng ô tô, ưu tiên **bản đồ và dữ liệu giao thông trước AI**. Tương thích GitHub Pages (bản đồ + dữ liệu GeoJSON + OSM + định tuyến thử nghiệm) và máy chủ Node.js tùy chọn (SSE / API nạp dữ liệu).

> **Chú ý an toàn:** bản thử nghiệm nghiên cứu, **không dùng để chỉ dẫn khi đang lái xe**. Dữ liệu mẫu hoàn toàn giả lập; OSM chỉ mô tả vị trí/các thẻ cộng đồng, **không cung cấp màu đèn tín hiệu trực tiếp**. Không khẳng định đã kết nối camera, trung tâm điều hành, DATMAP hay feed hiện trường.

## Khởi động

- **GitHub Pages:** Settings → Pages → Build and deployment: Deploy from a branch → `main` / `/ (root)`. Mở `https://xulytiengviet.github.io/giaothong/`. Nạp MapLibre từ CDN, nền OpenFreeMap; cần Internet.
- **Local:** Node.js ≥ 20; chạy `npm start`, mở `http://localhost:4173`; không có bước cài thư viện. `npm test` để chạy kiểm tra.
- **API thực:** đặt `INGEST_TOKEN` đủ mạnh trên server, cấu hình `ALLOWED_ORIGIN` khi frontend và backend khác miền. Từ giao diện nhập URL gốc của backend rồi nhấn **Kết nối dữ liệu trực tiếp**. Backend phát SSE theo thời gian thực khi *thực sự có* nguồn đẩy dữ liệu vào.
- **Dữ liệu tự có:** nhấn **Nhập GeoJSON**; thuộc tính `layer` phải là một trong các nhóm trong `src/config.js`. Xuất tập dữ liệu đang hiển thị bằng **Xuất GeoJSON**.
- **OSM:** sau khi zoom vào khu vực (≥11), nhấn **Nạp biển báo & đèn (OSM)**; truy vấn theo khung nhìn, thủ công, không crawl cả Việt Nam. Tọa độ là WGS84 `[longitude,latitude]`.

## Kiến trúc

```text
OpenFreeMap / OSM → MapLibre GL JS → lớp GeoJSON theo loại → WebGIS
         OSM Overpass → vị trí biển báo, vị trí đèn (không có trạng thái)
       feed có phép → POST /api/ingest → xác thực/kiểm tra → SSE /api/events
         dữ liệu riêng → nhập GeoJSON ────────────────┘
       OSRM demo / OSRM tự host → tuyến ô tô → đường đi và chỉ dẫn cơ bản
```

**Nhóm lớp:** traffic (tốc độ/ùn tắc), warning, sign, signal, camera, restriction, closure, roadworks, flood, parking, toll, weather. Mỗi đối tượng có `id`, `layer`, `name`, `source`, `updated_at`, `expires_at`, `severity`, `confidence`, `geometry` và các thuộc tính mở rộng theo nguồn. `signal.state` mặc định **unknown**; chỉ hiển thị màu đèn hiện thời nếu feed được cấp phép cung cấp trạng thái và dấu thời gian.

**Định tuyến:** nút chọn điểm đầu/đích trên bản đồ → yêu cầu đến endpoint OSRM cấu hình → hình tuyến, cự ly, ETA **ước tính**. Endpoint công cộng `router.project-osrm.org` chỉ để thử nghiệm với tần suất thấp, không có dữ liệu kẹt xe hay tín hiệu trực tiếp; sản xuất dùng OSRM/Valhalla tự host và engine chi phí động có dữ liệu đã kiểm chứng. Không tự động sửa tuyến dựa trên tin báo chưa xác minh.

**Triển khai dữ liệu thật:** nhà cung cấp được cấp quyền → adapter ETL (chuẩn hóa CRS WGS84, thuộc tính, quality flag, directionality, map matching) → PostGIS / stream broker → /api/ingest → SSE cho bản đồ; cung cấp API có quyền truy cập/giấy phép thích hợp. Không sao chép hay vượt cơ chế bảo vệ dữ liệu ứng dụng bên thứ ba.

## API ingest

```bash
INGEST_TOKEN=change-to-a-long-random-secret npm start
curl -X POST http://localhost:4173/api/ingest \
 -H "Authorization: Bearer change-to-a-long-random-secret" \
 -H "Content-Type: application/json" \
 --data-binary @data/example-live.json
```

`GET /api/feed`: snapshot GeoJSON; `GET /api/events`: SSE (sự kiện `snapshot`, `upsert`); `GET /api/health`: trạng thái. Nếu dùng domain khác, khai báo `ALLOWED_ORIGIN=https://xulytiengviet.github.io`. Đây là **ingest gateway MVP bộ nhớ tạm**, chưa phải hạ tầng giao thông quy mô quốc gia.

## Ghi công / nguồn

- MapLibre GL JS: https://maplibre.org/
- OpenFreeMap: https://openfreemap.org/ (dữ liệu nền OpenStreetMap, ODbL, giữ attribution trên bản đồ)
- OSM Overpass: https://wiki.openstreetmap.org/wiki/Overpass_API (giới hạn tải, không có dữ liệu live signal)
- OSRM: https://project-osrm.org/ (demo best-effort, không dùng production)
- Các nguồn DATMAP/camera/ATMS chỉ đưa vào khi có quyền khai thác và API hợp pháp.

Bản dựng khung 2026 · Long Ngo / cộng đồng.
