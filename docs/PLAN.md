# Kế hoạch triển khai — Woo Admin Mobile

## Hiện trạng repo
Repo trống → dùng React Native + Expo + TypeScript (mobile), Node.js + TypeScript (Fastify) cho backend, PostgreSQL.

## Sơ đồ kết nối

```
 iPhone / Android (Expo app)                     VPS (Docker Compose / Coolify)
 ┌──────────────────────────┐   HTTPS + Bearer    ┌───────────────────────────────┐
 │ Tổng quan · Đơn · SP ·   │ ──────────────────▶ │ api  (Fastify)                │
 │ Cài đặt · Chuông         │ ◀────────────────── │  - auth phiên (token băm)     │
 │ SecureStore: token phiên │                     │  - REST cho app               │
 └──────────▲───────────────┘                     │  - /webhooks/woocommerce/:id  │
            │ push (APNs/FCM)                     │ worker (cùng image)           │
 ┌──────────┴───────────────┐   Expo Push API     │  - xử lý webhook → sự kiện    │
 │ Expo Push Service        │ ◀────────────────── │  - gửi push, kiểm tra receipt │
 └──────────────────────────┘                     │  - đồng bộ ban đầu / đối soát │
                                                   │ PostgreSQL                    │
                                                   └──────────────┬────────────────┘
                                                                  │ HTTPS (Consumer Key/Secret)
                                                   ┌──────────────▼────────────────┐
                                                   │ WordPress + WooCommerce        │
                                                   │  REST /wc/v3, webhooks (HMAC)  │
                                                   │  AST: /wc-shipment-tracking/v3 │
                                                   └───────────────────────────────┘
```

## Cấu trúc thư mục

```
woo-admin/
  backend/            Fastify API + worker, migrations SQL, test tích hợp (mock WooCommerce)
    migrations/       *.sql chạy tuần tự, có bảng schema_migrations
    src/
      woo/            client REST WooCommerce, ánh xạ dữ liệu
      services/       shop, sync, webhook, events, push, analytics, orders, products
      routes/         auth, shop, dashboard, orders, products, notifications, devices, webhooks
      jobs/           hàng đợi Postgres (SKIP LOCKED) + worker
    test/             vitest: mock WooCommerce + Postgres thật
  mobile/             Expo Router app
    app/              (tabs)/index, orders, products, settings; notifications; login
    src/api/          client backend + client demo (cùng interface)
    src/ui/           thành phần giao diện
  docker-compose.yml  db + api + worker
  README.md           hướng dẫn tiếng Việt
```

## Màn hình
1. Đăng nhập (email/mật khẩu, nút “Xem bản demo”)
2. Tổng quan: KPI (Doanh thu, Đơn mới, Cần xử lý, Giá trị TB) → biểu đồ → đơn gần nhất → bán chạy; bộ lọc ngày; múi giờ shop; tiến độ đồng bộ; giải thích công thức
3. Đơn hàng: tìm, lọc trạng thái/ngày, phân trang, kéo làm mới → Chi tiết đơn (sao chép, đổi trạng thái có xác nhận, ghi chú nội bộ / gửi khách tách riêng, tracking AST, mở WP Admin)
4. Sản phẩm: tìm tên/SKU/SKU biến thể, lọc danh mục/tồn → Chi tiết → Sửa giá/tồn (biến thể), xem trước thay đổi, cảnh báo xung đột; Tạo sản phẩm nháp → Đăng bán
5. Cài đặt: shop, kết nối, kiểm tra kết nối, thông báo, kiểm tra thông báo, đăng xuất
6. Lịch sử thông báo (chuông)

## Thứ tự triển khai
1. Backend: migrations, auth, client Woo, kết nối shop + kiểm tra kết nối + tự tạo webhook
2. Đồng bộ đơn (mới nhất trước, tiếp tục sau khởi động lại) → webhook → sự kiện nghiệp vụ (chống trùng) → push Expo → receipt
3. Mobile: đăng nhập, danh sách/chi tiết đơn, đăng ký push, deep link từ thông báo (cả khi app đóng)
4. Dashboard + analytics theo múi giờ shop, tách tiền tệ
5. Sản phẩm/biến thể, tồn kho theo cấu hình Woo, xung đột, idempotency
6. Demo mode, Docker, README, test các tình huống
