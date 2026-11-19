<?php
/**
 * Plugin Name: Woo Admin Tracker
 * Description: Gửi lượt truy cập ẩn danh (phiên, trang, bước mua hàng) về backend Woo Admin để app hiển thị Live, phễu và tỉ lệ chuyển đổi. Không gửi IP, tên, email hay nội dung giỏ hàng.
 * Version: 1.0.0
 * Requires PHP: 7.4
 * WC requires at least: 7.0
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

const WOO_ADMIN_TRACKER_OPTION = 'woo_admin_tracker';

/** Trang cài đặt: Cài đặt → Woo Admin Tracker */
add_action('admin_menu', function () {
    add_options_page('Woo Admin Tracker', 'Woo Admin Tracker', 'manage_woocommerce', 'woo-admin-tracker', 'woo_admin_tracker_settings_page');
});

add_action('admin_init', function () {
    register_setting('woo_admin_tracker', WOO_ADMIN_TRACKER_OPTION, [
        'type' => 'array',
        'sanitize_callback' => function ($v) {
            return [
                'endpoint' => esc_url_raw(trim($v['endpoint'] ?? '')),
                'token' => sanitize_text_field(trim($v['token'] ?? '')),
            ];
        },
    ]);
});

function woo_admin_tracker_settings_page()
{
    $o = get_option(WOO_ADMIN_TRACKER_OPTION, ['endpoint' => '', 'token' => '']);
    ?>
    <div class="wrap">
        <h1>Woo Admin Tracker</h1>
        <p>Lấy <strong>Endpoint</strong> và <strong>Token</strong> trong app Woo Admin: Cài đặt → Theo dõi lượt truy cập.</p>
        <form method="post" action="options.php">
            <?php settings_fields('woo_admin_tracker'); ?>
            <table class="form-table">
                <tr><th><label for="wat-endpoint">Endpoint</label></th>
                    <td><input id="wat-endpoint" class="regular-text" name="<?php echo esc_attr(WOO_ADMIN_TRACKER_OPTION); ?>[endpoint]" value="<?php echo esc_attr($o['endpoint'] ?? ''); ?>" placeholder="https://api.shop-cua-ban.com/t/1"></td></tr>
                <tr><th><label for="wat-token">Token</label></th>
                    <td><input id="wat-token" class="regular-text" name="<?php echo esc_attr(WOO_ADMIN_TRACKER_OPTION); ?>[token]" value="<?php echo esc_attr($o['token'] ?? ''); ?>"></td></tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/** Xác định bước mua hàng của trang hiện tại */
function woo_admin_tracker_stage()
{
    if (!function_exists('is_woocommerce')) {
        return ['page', null];
    }
    if (function_exists('is_order_received_page') && is_order_received_page()) {
        global $wp;
        return ['purchase', isset($wp->query_vars['order-received']) ? absint($wp->query_vars['order-received']) : null];
    }
    if (is_checkout()) {
        return ['checkout', null];
    }
    if (is_cart()) {
        return ['cart', null];
    }
    if (is_product()) {
        return ['product', null];
    }
    return ['page', null];
}

add_action('wp_footer', function () {
    if (is_admin() || current_user_can('manage_woocommerce')) {
        return; // không đếm chủ shop/nhân viên
    }
    $o = get_option(WOO_ADMIN_TRACKER_OPTION, []);
    if (empty($o['endpoint']) || empty($o['token'])) {
        return;
    }
    [$stage, $order] = woo_admin_tracker_stage();
    $has_cart = function_exists('WC') && WC()->cart && WC()->cart->get_cart_contents_count() > 0;
    $cfg = [
        'e' => $o['endpoint'],
        'k' => $o['token'],
        't' => $stage,
        'o' => $order,
        'c' => $has_cart,
    ];
    ?>
<script>
(function (cfg) {
  try {
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
    var KEY = 'wa_sid', now = Date.now(), s;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    // phiên mới sau 30 phút không hoạt động
    if (!s || now - s.t > 30 * 60 * 1000) {
      var r = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(r);
      s = { id: Array.prototype.map.call(r, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('') };
    }
    s.t = now; localStorage.setItem(KEY, JSON.stringify(s));
    var q = new URLSearchParams(location.search);
    var send = function (t, extra) {
      var body = JSON.stringify(Object.assign({ k: cfg.k, sid: s.id, t: t, p: location.pathname, r: document.referrer, u: q.get('utm_source') || '',
        m: /Mobi|Android|iPhone/i.test(navigator.userAgent), c: cfg.c }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(cfg.e, new Blob([body], { type: 'text/plain' }));
      else fetch(cfg.e, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
    };
    send(cfg.t, cfg.o ? { o: cfg.o } : null);
    // thêm vào giỏ bằng AJAX (giao diện cổ điển) và Blocks
    if (window.jQuery) jQuery(document.body).on('added_to_cart', function () { send('cart'); });
    document.addEventListener('wc-blocks_added_to_cart', function () { send('cart'); });
  } catch (e) {}
})(<?php echo wp_json_encode($cfg); ?>);
</script>
    <?php
}, 99);
