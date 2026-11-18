/** Sự kiện trong app: một đơn vừa được cập nhật (đã có phản hồi xác nhận từ WooCommerce) */
type OrderPatch = { id: number; status: string; paid: boolean };
const listeners = new Set<(o: OrderPatch) => void>();

export function emitOrderUpdated(o: OrderPatch) {
  listeners.forEach((l) => l(o));
}

export function onOrderUpdated(l: (o: OrderPatch) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
