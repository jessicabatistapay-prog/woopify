# Woo Admin — App quản trị WooCommerce cho iPhone & Android

App di động (React Native + Expo) và backend (Node.js + TypeScript + PostgreSQL) để chủ shop WooCommerce xem doanh số, xử lý đơn, sửa giá/tồn kho theo biến thể và **nhận push khi có đơn mới**.

```
Điện thoại ──HTTPS──▶ Backend (VPS) ──HTTPS + API key──▶ WooCommerce
     ▲                    │  ▲
     └── APNs/FCM ◀─ Expo Push ◀┘  └── Webhook (ký HMAC) ── WooCommerce
```

- Consumer Key/Secret và webhook secret **chỉ nằm trên backend** (mã hóa AES-256-GCM trong Postgres). App chỉ giữ token phiên đăng nhập trong Keychain/Keystore.
- WooCommerce là nguồn dữ liệu gốc. Mọi thao tác sửa đều hiển thị giá trị do WooCommerce trả về.
- Dùng REST API chính thức `wc/v3`, tương thích HPOS. **Không cần plugin WordPress bổ sung.** AST (Advanced Shipment Tracking) được tự phát hiện nếu có.

Kế hoạch & kiến trúc chi tiết: [`docs/PLAN.md`](docs/PLAN.md).

---

## Mục lục

1. [Xem thử ngay (chế độ demo)](#1-xem-thử-ngay-chế-độ-demo)
2. [Lấy API key WooCommerce](#2-lấy-api-key-woocommerce)
3. [Triển khai backend lên VPS (Docker Compose, HTTPS)](#3-triển-khai-backend-lên-vps)
4. [Triển khai bằng Coolify](#4-triển-khai-bằng-coolify)
5. [Tạo tài khoản quản trị đầu tiên](#5-tạo-tài-khoản-quản-trị-đầu-tiên)
6. [Kết nối website & cấu hình webhook](#6-kết-nối-website--cấu-hình-webhook)
7. [Cấu hình push notification (Expo / APNs / FCM)](#7-cấu-hình-push-notification)
8. [Cài bản thử lên iPhone / Android](#8-cài-bản-thử-lên-iphone--android)
9. [Kiểm tra nghiệm thu trên điện thoại thật](#9-kiểm-tra-nghiệm-thu-trên-điện-thoại-thật)
10. [Cách tính số liệu](#10-cách-tính-số-liệu)
    - [Báo cáo chi tiết, Live & tỉ lệ chuyển đổi](#báo-cáo-chi-tiết-live--tỉ-lệ-chuyển-đổi)
    - [Quản lý cửa hàng trong app](#quản-lý-cửa-hàng-trong-app)
11. [Phát triển, test, chạy cục bộ](#11-phát-triển-test-chạy-cục-bộ)
12. [Xử lý sự cố](#12-xử-lý-sự-cố)

---

## 1. Xem thử ngay (chế độ demo)

Không cần backend hay API key. Trên máy tính có Node.js 22+:

```bash
cd mobile && npm install
```

```bash
npx expo start --go
```

- Mở app **Expo Go** trên điện thoại, quét mã QR → bấm **“Xem bản demo”**.
- Hoặc bấm `w` để mở trong trình duyệt.

Dữ liệu demo gồm đơn túi xách, giày, phụ kiện (USD + vài đơn CAD), có đơn sát nửa đêm theo giờ New York, đơn hoàn tiền một phần, sản phẩm có tồn kho dùng chung với sản phẩm cha. Mọi màn hình hiện nhãn **“Dữ liệu demo”**. Dữ liệu chỉ nằm trong bộ nhớ app, không gọi mạng và tách hẳn khỏi kết nối shop thật.

> Expo Go dùng được cho demo. **Push thật cần development build** (mục 8).

---

## 2. Lấy API key WooCommerce

1. Đăng nhập WordPress bằng tài khoản **Quản trị viên** hoặc **Quản lý cửa hàng**.
2. Vào **WooCommerce → Cài đặt → Nâng cao → REST API** → **Thêm khóa**.
3. Mô tả: `Woo Admin Mobile`. Người dùng: tài khoản của bạn. **Quyền: Đọc/Ghi (Read/Write)**.
4. Bấm **Tạo khóa API**, sao chép **Consumer Key** (`ck_…`) và **Consumer Secret** (`cs_…`). Secret chỉ hiện một lần.
5. Kiểm tra **Cài đặt → Đường dẫn tĩnh**: không dùng kiểu “Thuần (Plain)”.

Khóa chỉ được dán vào app một lần (màn hình Cài đặt → Kết nối cửa hàng). App gửi khóa qua HTTPS tới backend của bạn, backend kiểm tra rồi lưu mã hóa. Điện thoại không giữ lại khóa. Bạn cũng có thể đặt khóa bằng biến môi trường trên server (`WC_STORE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` trong `.env`).

---

## 3. Triển khai backend lên VPS

Yêu cầu: VPS Linux có Docker, một tên miền con trỏ về VPS (ví dụ `api.shop-cua-ban.com`).

```bash
git clone <repo-cua-ban> woo-admin && cd woo-admin
```

```bash
cp .env.example .env
```

Sửa `.env`:

| Biến | Giá trị |
|---|---|
| `POSTGRES_PASSWORD` | chuỗi ngẫu nhiên dài |
| `APP_SECRET` | `openssl rand -base64 48` (≥ 32 ký tự, **giữ cố định**, đổi sẽ không giải mã được khóa đã lưu) |
| `PUBLIC_URL` | `https://api.shop-cua-ban.com` (WooCommerce gửi webhook tới `PUBLIC_URL/webhooks/woocommerce/<id>`) |
| `EXPO_ACCESS_TOKEN` | tùy chọn, xem mục 7 |

Khởi động:

```bash
docker compose up -d --build
```

Có 3 service: `db` (Postgres 16), `api` (HTTP, cổng `127.0.0.1:3000`) và `worker` (xử lý webhook, gửi push, đồng bộ, đối soát định kỳ). Migration chạy tự động khi khởi động.

### Bật HTTPS bằng Caddy (đơn giản nhất)

Cài Caddy trên VPS, tạo `/etc/caddy/Caddyfile`:

```
api.shop-cua-ban.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Caddy tự xin chứng chỉ Let's Encrypt. Kiểm tra:

```bash
curl https://api.shop-cua-ban.com/health
```

Nếu dùng Nginx/Traefik, chuyển tiếp toàn bộ đường dẫn về cổng 3000 và giữ nguyên body (webhook cần raw body để kiểm tra chữ ký).

---

## 4. Triển khai bằng Coolify

1. **New Resource → Docker Compose**, trỏ tới repo, file `docker-compose.yml`.
2. Ở tab **Environment Variables**, thêm các biến như bảng mục 3.
3. Gán domain `https://api.shop-cua-ban.com` cho service **api**, cổng `3000`. Coolify tự cấp HTTPS.
4. Xóa dòng `ports:` của service `api` nếu Coolify báo trùng cổng (Coolify đi qua proxy nội bộ).
5. Deploy. Mở terminal của service `api` trong Coolify để chạy lệnh tạo admin (mục 5).

---

## 5. Tạo tài khoản quản trị đầu tiên

```bash
docker compose exec api node dist/cli.js create-admin ban@email.com
```

Nhập mật khẩu (≥ 10 ký tự) khi được hỏi. Chạy lại cùng email để đổi mật khẩu.

Các lệnh khác:

```bash
docker compose exec api node dist/cli.js webhook-info
```

(in Delivery URL + secret để tạo webhook thủ công, chỉ chạy trên server)

---

## 6. Kết nối website & cấu hình webhook

Trong app: **Đăng nhập** (địa chỉ backend `https://api.shop-cua-ban.com`, email, mật khẩu) → **Cài đặt → Kết nối cửa hàng** → nhập URL website, Consumer Key, Consumer Secret → **Kiểm tra trước** → **Lưu & kết nối**.

Backend sẽ:
1. Kiểm tra từng bước: URL → xác thực → quyền đọc → quyền ghi → webhook → backend nhận webhook. Lỗi được báo đúng bước kèm gợi ý sửa.
2. **Tự tạo webhook** trong WooCommerce (`order.created`, `order.updated`, `order.deleted`, `order.restored`, `product.created/updated/deleted`) với secret do backend sinh ra.
3. Đồng bộ lần đầu: đơn đang mở (Đang xử lý / Tạm giữ / Chờ thanh toán) trước, rồi lịch sử từ mới đến cũ ở nền. Dashboard hiện tiến độ “đủ dữ liệu từ ngày …”. Đồng bộ **tiếp tục được sau khi backend khởi động lại**. **Đơn cũ không gây thông báo.**
4. Đối soát định kỳ mỗi 10 phút (`modified_after`) để bù webhook bị lỡ.

**Tạo webhook thủ công** (nếu không muốn cấp quyền ghi webhook): WooCommerce → Cài đặt → Nâng cao → Webhooks → Thêm. Trạng thái **Hoạt động**. Topic: *Order created*, rồi tạo thêm một cái *Order updated*. Delivery URL và Secret lấy từ `webhook-info`. API version **WP REST API Integration v3**.

Bấm **Kiểm tra kết nối** bất cứ lúc nào. Nếu WooCommerce đã tự tắt webhook (sau nhiều lần gửi lỗi), bấm **Tạo/sửa webhook tự động** để bật lại.

---

## 7. Cấu hình push notification

Luồng: WooCommerce → webhook (kiểm tra chữ ký HMAC-SHA256) → lưu sự kiện → worker → **Expo Push Service** → APNs (iOS) / FCM (Android) → điện thoại. App không cần mở.

**Logic chống trùng / đúng sự kiện** (đã có test):
- “Đơn mới” = đơn rời trạng thái nháp (`checkout-draft`/`auto-draft` của Checkout Blocks bị bỏ qua). Phát hiện cả khi đơn chuyển từ nháp sang hợp lệ qua `order.updated`.
- “Đã thanh toán” = có `date_paid` hoặc trạng thái Đang xử lý/Hoàn thành.
- Mỗi (shop, đơn, loại sự kiện) chỉ một lần; mỗi thiết bị nhận tối đa một push cho mỗi sự kiện. Webhook gửi lại, nhiều cập nhật liên tiếp hay webhook sai thứ tự đều không gây trùng.
- “Đơn mới” chờ `PUSH_COALESCE_SECONDS` (mặc định 8 giây) để nội dung phản ánh đúng đơn đã thanh toán ngay hay đang chờ.
- Nội dung push: `Đơn mới #10428 · 149,00 USD` / `2 sản phẩm · Chờ thanh toán`. Không bao giờ chứa tên, địa chỉ, điện thoại, email. Có tùy chọn ẩn số tiền.
- Lỗi tạm thời được thử lại với backoff. Token chết (`DeviceNotRegistered`) tự bị vô hiệu hóa. Đăng xuất thì thiết bị ngừng nhận push.

### Bước cài đặt

1. Tạo tài khoản Expo miễn phí tại expo.dev, rồi trong thư mục `mobile`:

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

Lệnh `init` in ra **project ID**. Ghi vào `mobile/.env` (copy từ `mobile/.env.example`):

```
EXPO_PUBLIC_EAS_PROJECT_ID=xxxxxxxx-xxxx-...
EXPO_PUBLIC_API_URL=https://api.shop-cua-ban.com
APP_BUNDLE_ID=com.tenshop.admin
```

2. **Android (FCM):**
   - Tạo project ở console.firebase.google.com → thêm app Android với package = `APP_BUNDLE_ID` → tải **google-services.json** về `mobile/google-services.json`.
   - Firebase → Project settings → Service accounts → **Generate new private key** (file JSON).
   - Tải key đó lên EAS: chạy `npx eas-cli@latest credentials` → Android → *Google Service Account* → *Manage your FCM V1 service account key* → chọn file JSON.

3. **iOS (APNs):** cần **Apple Developer Program** (99 USD/năm). Khi chạy `eas build` lần đầu cho iOS, EAS hỏi đăng nhập Apple và tự tạo APNs key, chứng chỉ và provisioning profile.

4. (Tùy chọn) Nếu bật *Enhanced Security for Push Notifications* trong Expo, tạo access token ở expo.dev → Account → Access tokens rồi đặt `EXPO_ACCESS_TOKEN` trong `.env` của backend.

---

## 8. Cài bản thử lên iPhone / Android

Push thật **không chạy trên Expo Go hay máy ảo**. Cần **development build** cài trên điện thoại thật.

### Android

```bash
cd mobile && npx eas-cli@latest build --profile development --platform android
```

Khi build xong, quét QR / mở link trên điện thoại để tải và cài APK. Sau đó chạy:

```bash
npx expo start --dev-client
```

Rồi mở app “Woo Admin” vừa cài. Muốn bản chạy độc lập không cần máy tính, dùng `--profile preview` (APK).

### iPhone

Đăng ký UDID thiết bị (mở link trên iPhone, cài profile):

```bash
npx eas-cli@latest device:create
```

```bash
npx eas-cli@latest build --profile development --platform ios
```

Mở link cài đặt trên iPhone. Vào **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển** để bật (iOS 16+). Rồi chạy:

```bash
npx expo start --dev-client
```

Khi mở app lần đầu sau khi đăng nhập, app xin quyền thông báo và tự đăng ký thiết bị với backend. Nếu bạn từ chối quyền, lịch sử thông báo trong app (biểu tượng chuông) vẫn hoạt động.

---

## 9. Kiểm tra nghiệm thu trên điện thoại thật

Vào **Cài đặt → Kiểm tra thông báo**:

1. **Quyền hệ điều hành** và **Đăng ký với backend** phải hiện xanh, có push token.
2. **Kiểm tra đường gửi push**: bấm **Gửi thông báo thử**. Khóa màn hình và chờ thông báo. Bước này chỉ kiểm tra backend → Expo → APNs/FCM → điện thoại.
3. **Kiểm tra toàn bộ luồng bằng đơn thật**: đặt một đơn thử trên website (checkout cổ điển hoặc Checkout Blocks). Kéo để làm mới, sẽ thấy lần lượt: (a) backend nhận webhook, (b) ghi nhận sự kiện “Đơn mới #…”, (c) trạng thái push tới điện thoại này.
4. **Vuốt app tắt hẳn**, đặt thêm một đơn, rồi chạm vào thông báo. App mở thẳng chi tiết đúng đơn, hiện trạng thái thanh toán.
5. Đổi trạng thái đơn trong app → mở **WooCommerce Admin** (nút “Mở trong WooCommerce Admin”) để xem thay đổi. Sửa giá một biến thể → mở sản phẩm trong WP Admin để kiểm tra.

---

## 10. Cách tính số liệu

Số liệu do backend tự tổng hợp từ đơn đã đồng bộ, theo định nghĩa mặc định của **WooCommerce Analytics**. Lý do tự tổng hợp: Analytics không tách theo tiền tệ và cần thêm bước import dữ liệu. Công thức (cũng có trong app, nút “Cách tính số liệu”):

| Chỉ số | Công thức |
|---|---|
| Đơn được tính | Đơn **tạo** trong kỳ (ngày theo **múi giờ website**), trừ *Chờ thanh toán, Thất bại, Đã hủy, nháp* |
| Doanh thu thuần | Σ tiền hàng trước giảm giá − mã giảm giá − hoàn tiền |
| Tổng doanh thu (“Doanh thu”) | Doanh thu thuần + phí vận chuyển + thuế |
| Hoàn tiền | Ghi nhận theo **ngày hoàn tiền**, kể cả hoàn một phần (lấy từ `/orders/{id}/refunds`). Có thể làm doanh thu một ngày âm. |
| Giá trị đơn TB | Doanh thu thuần ÷ số đơn được tính |
| Đơn mới | Mọi đơn khách đã gửi trong kỳ, gồm cả Chờ thanh toán. Không gồm `checkout-draft` |
| Đã thanh toán | Đơn có `date_paid` trong kỳ |
| Cần xử lý | Số đơn đang ở trạng thái *Đang xử lý* hiện tại, không phụ thuộc bộ lọc ngày |
| Nhiều tiền tệ | Mỗi loại tiền tính riêng, không quy đổi |

Phí phụ thu (fee lines) không cộng vào doanh thu, giống Analytics. Múi giờ lấy từ `timezone_string` của WordPress. Nếu site dùng độ lệch thủ công (ví dụ UTC+7) thì dùng độ lệch đó. Múi giờ luôn hiện trên dashboard.

---

### Báo cáo chi tiết, Live & tỉ lệ chuyển đổi

Mở từ **Tổng quan → Live & báo cáo chi tiết** hoặc **Cài đặt → Báo cáo & Live**.

| Tab | Nội dung | Nguồn dữ liệu |
|---|---|---|
| **Live** (tự làm mới 15 giây) | Người đang xem website, giỏ đang mở, đang ở bước thanh toán, doanh thu hôm nay so với cùng giờ hôm qua, biểu đồ cộng dồn theo giờ, đơn hôm nay | Đơn: WooCommerce. Người xem: plugin tracker |
| **Bán hàng** | Sản phẩm / biến thể / danh mục bán chạy, khách mới & quay lại, quốc gia & bang, nguồn đơn (Order Attribution), phương thức thanh toán, mã giảm giá đã dùng, theo trạng thái | Đơn đã đồng bộ (không cần plugin) |
| **Truy cập** | Tỉ lệ chuyển đổi, phiên, phễu (xem sản phẩm → giỏ → thanh toán → đặt hàng), nguồn truy cập, trang vào đầu tiên | Plugin tracker |

**Vì sao cần plugin cho Live/chuyển đổi?** WooCommerce không ghi lượt truy cập, nên REST API không có số liệu này. Plugin `wordpress-plugin/woo-admin-tracker.zip` gửi lượt xem trang ẩn danh về backend:
- Có gửi: mã phiên ngẫu nhiên, đường dẫn trang, nguồn truy cập (referrer, `utm_source`), loại thiết bị, bước mua hàng.
- Không gửi: IP, tên, email, nội dung giỏ hàng.
- Tôn trọng Do Not Track và GPC. Không đếm lượt xem của quản trị viên.

Cài đặt:
1. WordPress → **Plugin → Cài mới → Tải plugin lên** → chọn `woo-admin-tracker.zip` → **Kích hoạt**.
2. Trong app: **Cài đặt → Quản lý cửa hàng → Theo dõi lượt truy cập**, sao chép **Endpoint** và **Token**.
3. WordPress → **Cài đặt → Woo Admin Tracker**: dán hai giá trị trên → Lưu.
4. Nếu dùng plugin cache (WP Rocket, LiteSpeed…): không cần loại trừ gì, vì script chạy phía trình duyệt.

Tỉ lệ chuyển đổi = số phiên có đặt hàng ÷ tổng số phiên, cùng cách Shopify tính. Phiên kết thúc sau 30 phút không hoạt động.

### Quản lý cửa hàng trong app

**Cài đặt → Quản lý cửa hàng**. Mọi thao tác đi qua REST API chính thức, có bước xem trước “cũ → mới” và hiển thị giá trị WooCommerce xác nhận:

| Mục | Làm được gì |
|---|---|
| Mã giảm giá | Tạo, sửa, bật/tắt, xóa. Loại giảm (%, số tiền, theo sản phẩm), hạn dùng, đơn tối thiểu, giới hạn lượt dùng, miễn phí vận chuyển |
| Khách hàng | Tìm, xem tổng chi và đơn gần đây, sửa tên/email/địa chỉ giao hàng |
| Thanh toán | Bật/tắt từng cổng thanh toán, sửa tiêu đề, mô tả và các tùy chọn của cổng |
| Vận chuyển | Xem vùng vận chuyển, bật/tắt phương thức, sửa phí và đơn tối thiểu để miễn phí vận chuyển |
| Cài đặt WooCommerce | Toàn bộ các nhóm trong WooCommerce → Cài đặt (Chung, Sản phẩm, Thuế, Tài khoản, Email, Nâng cao…). App tự dựng form theo từng loại trường |
| Sản phẩm | Ngoài giá/tồn kho: tên, SKU, mô tả ngắn/chi tiết, trạng thái (đang bán, nháp, riêng tư), danh mục, nổi bật, hiển thị |

Những phần REST API không hỗ trợ vẫn phải làm trên web: trang cài đặt riêng của plugin bên thứ ba, giao diện (theme), hoàn tiền qua cổng thanh toán, sửa ảnh hoặc bảng trong mô tả sản phẩm. Nút **“Mở trong WooCommerce Admin”** vẫn có ở đơn và sản phẩm.

### Âm thanh thông báo đơn mới

Mặc định là âm **“Ka-ching”** (tiếng tiền về). Âm này tự tổng hợp cho dự án, không dùng âm thanh của Shopify. File nằm ở `mobile/assets/sounds/ka_ching.wav`. Đổi trong **Cài đặt → Thông báo → Âm thanh đơn mới**, có nút **Nghe thử**.
- iOS: backend gửi `sound: ka_ching.wav` trong push.
- Android: mỗi âm thanh là một kênh thông báo riêng (`orders_kaching` / `orders`), vì Android khóa âm thanh của kênh sau khi tạo.
- Muốn thay bằng âm khác: đặt file `.wav` (dưới 30 giây) cùng tên vào `mobile/assets/sounds/`, rồi **build lại app** (`eas build`). Âm thanh được đóng gói trong app nên không cập nhật OTA được.

## 11. Phát triển, test, chạy cục bộ

```
backend/   Fastify API + worker, migrations/, test/ (vitest + Postgres thật + WooCommerce giả lập)
mobile/    Expo Router app (src/app = màn hình, src/api = client thật + demo)
docs/      PLAN.md
```

### Backend

Cần PostgreSQL (tạo database `wooadmin_test` cho test):

```bash
cd backend && npm install
```

```bash
npm run typecheck && npm run lint && npm test
```

Biến `TEST_DATABASE_URL` mặc định là `postgres://woo:woo@127.0.0.1:5432/wooadmin_test`.

**Chạy toàn bộ luồng cục bộ không cần website thật**: mock WooCommerce có sẵn dữ liệu và endpoint đặt đơn.

```bash
npx tsx scripts/mock-woo.ts
```

```bash
DATABASE_URL=postgres://woo:woo@127.0.0.1:5432/wooadmin APP_SECRET=local-dev-secret-local-dev-secret-0001 PUBLIC_URL=http://127.0.0.1:3000 WC_ALLOW_HTTP=true npm run dev
```

Kết nối shop trong app với URL `http://127.0.0.1:8081`, key `ck_test_1234567890`, secret `cs_test_1234567890`. Đặt đơn thử (sinh webhook thật có chữ ký):

```bash
curl -X POST localhost:8081/__mock/order -d '{"status":"pending"}'
```

### Mobile

```bash
cd mobile && npm install
```

```bash
npm run typecheck && npm run lint && npm test
```

```bash
npx expo export --platform web
```

---

## 12. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| “Xác thực thất bại” dù khóa đúng | Máy chủ Apache/LiteSpeed đang chặn header Authorization. Thêm vào `.htaccess` (trước khối WordPress): `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` |
| “Máy chủ không trả về JSON” | Bật permalink khác “Plain”. Kiểm tra plugin bảo mật/Cloudflare có chặn `/wp-json/` không |
| Không nhận webhook | `PUBLIC_URL` phải là HTTPS công khai. Kiểm tra firewall, rồi bấm “Tạo/sửa webhook tự động”. Xem WooCommerce → Trạng thái → Nhật ký (`webhooks-delivery`) |
| “Chữ ký không khớp” | Secret trong WooCommerce khác secret của backend. Bấm “Tạo/sửa webhook tự động” |
| Gửi thử OK nhưng đơn thật không báo | Kiểm tra mục 9, bước 3. Xem “Ghi nhận sự kiện”: nếu ghi “không báo: đơn cũ” thì đồng hồ server lệch hoặc đơn tạo trước khi kết nối |
| Không có push token | Phải dùng development build trên máy thật, đã cấp quyền, và đã đặt `EXPO_PUBLIC_EAS_PROJECT_ID` |
| Android không hiện thông báo | Kiểm tra đã tải FCM V1 key lên EAS. Bật kênh “Đơn hàng” trong cài đặt thông báo của app |
| Hết phiên đăng nhập | Phiên kéo dài 60 ngày kể từ lần dùng cuối. App tự đưa về màn hình đăng nhập kèm thông báo |
| Mất mạng khi đang lưu | App kiểm tra lại giá trị trên website trước khi cho gửi lại. Ghi chú và tạo sản phẩm dùng khóa idempotency nên không tạo trùng |

**Bảo mật:** không commit `.env`. Đổi khóa WooCommerce thì vào Kết nối cửa hàng → Đổi thông tin kết nối. Thu hồi khóa trong WooCommerce → REST API nếu mất điện thoại (phiên app cũng có thể thu hồi bằng cách đổi mật khẩu qua `create-admin`).
