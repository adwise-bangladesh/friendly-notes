import type { QueryClient } from "@tanstack/react-query";
import { invalidateOrderSurfaces } from "./order-cache";

/**
 * Single place that knows which cached surfaces show shipping / exception
 * state. Booking, courier assignment, delivery outcomes, exception ownership
 * and resolution all call this, so the shipping desk, the quick views, the
 * shipment page, the exception desk and the order page can never disagree.
 *
 * Only the surfaces that can actually change are invalidated — nothing global.
 */
export function invalidateShippingSurfaces(
  qc: QueryClient,
  ids: { shipmentId?: string | null; orderId?: string | null; exceptionId?: string | null } = {},
): void {
  void qc.invalidateQueries({ queryKey: ["shipments-console"] });
  void qc.invalidateQueries({ queryKey: ["shipment-queue"] });
  void qc.invalidateQueries({ queryKey: ["exceptions-console"] });
  void qc.invalidateQueries({ queryKey: ["exception-queue"] });
  void qc.invalidateQueries({ queryKey: ["open-exception-count"] });
  void qc.invalidateQueries({ queryKey: ["attention-feed"] });

  if (ids.shipmentId) {
    void qc.invalidateQueries({ queryKey: ["shipment", ids.shipmentId] });
    void qc.invalidateQueries({ queryKey: ["shipment-events", ids.shipmentId] });
    void qc.invalidateQueries({ queryKey: ["shipment-courier-events", ids.shipmentId] });
    void qc.invalidateQueries({ queryKey: ["shipment-quick-view", ids.shipmentId] });
    void qc.invalidateQueries({ queryKey: ["shipment-profitability", ids.shipmentId] });
  } else {
    void qc.invalidateQueries({ queryKey: ["shipment-quick-view"] });
  }

  if (ids.exceptionId) {
    void qc.invalidateQueries({ queryKey: ["exception-quick-view", ids.exceptionId] });
  } else {
    void qc.invalidateQueries({ queryKey: ["exception-quick-view"] });
  }

  if (ids.orderId) {
    void qc.invalidateQueries({ queryKey: ["order-shipments", ids.orderId] });
    void qc.invalidateQueries({ queryKey: ["order-exceptions", ids.orderId] });
    void qc.invalidateQueries({ queryKey: ["order-returns", ids.orderId] });
    invalidateOrderSurfaces(qc, ids.orderId);
  } else {
    void qc.invalidateQueries({ queryKey: ["orders-console"] });
  }
}
