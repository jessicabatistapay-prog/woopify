-- Woo Admin: schema khởi tạo
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE shops (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL DEFAULT '',
  url                  TEXT NOT NULL,
  consumer_key_enc     TEXT NOT NULL,
  consumer_secret_enc  TEXT NOT NULL,
  webhook_secret_enc   TEXT NOT NULL,
  timezone             TEXT NOT NULL DEFAULT 'UTC',
  currency             TEXT NOT NULL DEFAULT 'USD',
  price_decimals       INT  NOT NULL DEFAULT 2,
  wc_version           TEXT,
  hpos_enabled         BOOLEAN,
  ast_enabled          BOOLEAN NOT NULL DEFAULT false,
  manage_stock_enabled BOOLEAN NOT NULL DEFAULT true,
  low_stock_amount     INT NOT NULL DEFAULT 2,
  notify_since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_webhook_at      TIMESTAMPTZ,
  last_webhook_topic   TEXT,
  last_ping_at         TIMESTAMPTZ,
  last_bad_signature_at TIMESTAMPTZ,
  last_check           JSONB,
  last_check_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_state (
  shop_id           INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  resource          TEXT NOT NULL,              -- 'orders' | 'products'
  status            TEXT NOT NULL DEFAULT 'idle', -- idle | running | done | error
  phase             TEXT NOT NULL DEFAULT 'open', -- orders: open -> history
  snapshot_before   TIMESTAMPTZ,
  next_page         INT NOT NULL DEFAULT 1,
  total_pages       INT,
  total_items       INT,
  synced_items      INT NOT NULL DEFAULT 0,
  oldest_synced_at  TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  last_reconcile_at TIMESTAMPTZ,
  last_error        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, resource)
);

CREATE TABLE orders (
  shop_id              INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  id                   BIGINT NOT NULL,
  number               TEXT NOT NULL,
  status               TEXT NOT NULL,
  currency             TEXT NOT NULL,
  total                NUMERIC(14,4) NOT NULL DEFAULT 0,
  items_subtotal       NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_total       NUMERIC(14,4) NOT NULL DEFAULT 0,
  shipping_total       NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_tax            NUMERIC(14,4) NOT NULL DEFAULT 0,
  refund_total         NUMERIC(14,4) NOT NULL DEFAULT 0,
  customer_name        TEXT NOT NULL DEFAULT '',
  billing_email        TEXT NOT NULL DEFAULT '',
  item_count           INT NOT NULL DEFAULT 0,
  payment_method_title TEXT NOT NULL DEFAULT '',
  created_via          TEXT NOT NULL DEFAULT '',
  date_created_gmt     TIMESTAMPTZ NOT NULL,
  date_paid_gmt        TIMESTAMPTZ,
  date_completed_gmt   TIMESTAMPTZ,
  date_modified_gmt    TIMESTAMPTZ NOT NULL,
  refund_ids           TEXT NOT NULL DEFAULT '',
  raw                  JSONB NOT NULL,
  search_text          TEXT NOT NULL DEFAULT '',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, id)
);
CREATE INDEX orders_created_idx ON orders (shop_id, date_created_gmt DESC);
CREATE INDEX orders_status_idx ON orders (shop_id, status, date_created_gmt DESC);
CREATE INDEX orders_paid_idx ON orders (shop_id, date_paid_gmt);

CREATE TABLE order_line_items (
  shop_id      INT NOT NULL,
  order_id     BIGINT NOT NULL,
  line_id      BIGINT NOT NULL,
  product_id   BIGINT NOT NULL DEFAULT 0,
  variation_id BIGINT NOT NULL DEFAULT 0,
  name         TEXT NOT NULL DEFAULT '',
  sku          TEXT NOT NULL DEFAULT '',
  quantity     INT NOT NULL DEFAULT 0,
  subtotal     NUMERIC(14,4) NOT NULL DEFAULT 0,
  total        NUMERIC(14,4) NOT NULL DEFAULT 0,
  image_url    TEXT,
  PRIMARY KEY (shop_id, order_id, line_id),
  FOREIGN KEY (shop_id, order_id) REFERENCES orders(shop_id, id) ON DELETE CASCADE
);

CREATE TABLE refunds (
  shop_id          INT NOT NULL,
  id               BIGINT NOT NULL,
  order_id         BIGINT NOT NULL,
  amount           NUMERIC(14,4) NOT NULL,
  reason           TEXT NOT NULL DEFAULT '',
  date_created_gmt TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES orders(shop_id, id) ON DELETE CASCADE
);
CREATE INDEX refunds_date_idx ON refunds (shop_id, date_created_gmt);

CREATE TABLE products (
  shop_id           INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  id                BIGINT NOT NULL,
  parent_id         BIGINT NOT NULL DEFAULT 0,
  type              TEXT NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  sku               TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '',
  price             TEXT NOT NULL DEFAULT '',
  regular_price     TEXT NOT NULL DEFAULT '',
  sale_price        TEXT NOT NULL DEFAULT '',
  manage_stock      TEXT NOT NULL DEFAULT 'false', -- 'true' | 'false' | 'parent'
  stock_quantity    INT,
  stock_status      TEXT NOT NULL DEFAULT 'instock',
  low_stock_amount  INT,
  image_url         TEXT,
  category_ids      INT[] NOT NULL DEFAULT '{}',
  attributes_label  TEXT NOT NULL DEFAULT '',
  date_modified_gmt TIMESTAMPTZ,
  raw               JSONB NOT NULL,
  deleted           BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, id)
);
CREATE INDEX products_parent_idx ON products (shop_id, parent_id);
CREATE INDEX products_sku_idx ON products (shop_id, lower(sku));

CREATE TABLE product_categories (
  shop_id INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  id      INT NOT NULL,
  name    TEXT NOT NULL,
  parent  INT NOT NULL DEFAULT 0,
  count   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, id)
);

CREATE TABLE webhook_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  shop_id         INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  delivery_id     TEXT,
  webhook_id      TEXT,
  topic           TEXT NOT NULL,
  resource_id     BIGINT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | processed | ignored | error | duplicate
  error           TEXT,
  payload         JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX webhook_deliveries_dedupe ON webhook_deliveries (shop_id, webhook_id, delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX webhook_deliveries_received ON webhook_deliveries (shop_id, received_at DESC);

-- Sự kiện nghiệp vụ: mỗi (shop, đơn, loại) chỉ một lần duy nhất
CREATE TABLE business_events (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id    BIGINT NOT NULL,
  type        TEXT NOT NULL,      -- order.placed | order.paid
  source      TEXT NOT NULL,      -- webhook | reconcile | initial | manual
  event_at    TIMESTAMPTZ NOT NULL,
  suppressed  BOOLEAN NOT NULL DEFAULT false,
  suppressed_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, order_id, type)
);

CREATE TABLE devices (
  id                 UUID PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id         UUID REFERENCES sessions(id) ON DELETE SET NULL,
  installation_id    TEXT NOT NULL UNIQUE,
  platform           TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  push_token         TEXT,
  permission         TEXT NOT NULL DEFAULT 'undetermined',
  notify_new_order   BOOLEAN NOT NULL DEFAULT true,
  notify_paid        BOOLEAN NOT NULL DEFAULT false,
  hide_amount        BOOLEAN NOT NULL DEFAULT false,
  active             BOOLEAN NOT NULL DEFAULT true,
  inactive_reason    TEXT,
  last_registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_push_at       TIMESTAMPTZ,
  last_push_status   TEXT,
  last_push_error    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     INT REFERENCES shops(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    BIGINT REFERENCES business_events(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,       -- order.placed | order.paid | test
  order_id    BIGINT,
  title       TEXT NOT NULL,
  title_private TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ,
  UNIQUE (event_id, user_id)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Chống gửi trùng theo (sự kiện → thông báo) × thiết bị
CREATE TABLE push_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued', -- queued | sent | delivered | error | skipped
  ticket_id       TEXT,
  error           TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notification_id, device_id)
);

CREATE TABLE jobs (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 8,
  locked_at    TIMESTAMPTZ,
  last_error   TEXT,
  dedupe_key   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX jobs_dedupe ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
CREATE INDEX jobs_ready ON jobs (status, run_at);

CREATE TABLE idempotency_keys (
  key        TEXT PRIMARY KEY,
  user_id    INT NOT NULL,
  operation  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | done
  request    JSONB NOT NULL,
  response   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE uploads (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
