-- Âm thanh thông báo đơn hàng theo từng thiết bị: 'kaching' (âm tiền về) | 'default' (âm hệ thống)
ALTER TABLE devices ADD COLUMN sound TEXT NOT NULL DEFAULT 'kaching';
