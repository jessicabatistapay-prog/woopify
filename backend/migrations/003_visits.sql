-- Lượt truy cập website (từ plugin Woo Admin Tracker). Không lưu IP, tên, email.
CREATE TABLE visits (
  shop_id          INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  session_id       TEXT NOT NULL,
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  landing_path     TEXT NOT NULL DEFAULT '',
  last_path        TEXT NOT NULL DEFAULT '',
  referrer_host    TEXT NOT NULL DEFAULT '',
  utm_source       TEXT NOT NULL DEFAULT '',
  device           TEXT NOT NULL DEFAULT 'desktop',
  pageviews        INT NOT NULL DEFAULT 0,
  viewed_product   BOOLEAN NOT NULL DEFAULT false,
  added_to_cart    BOOLEAN NOT NULL DEFAULT false,
  reached_checkout BOOLEAN NOT NULL DEFAULT false,
  purchased        BOOLEAN NOT NULL DEFAULT false,
  order_id         BIGINT,
  PRIMARY KEY (shop_id, session_id)
);
CREATE INDEX visits_first_seen ON visits (shop_id, first_seen);
CREATE INDEX visits_last_seen ON visits (shop_id, last_seen);
