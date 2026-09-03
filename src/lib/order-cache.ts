import type { QueryClient } from "@tanstack/react-query";

/**
 * Single place that knows which cached surfaces show order / verification work
 * state. Any action that changes assignment, verification, items or lifecycle
 * must call this so the Orders console, the quick view, the verification queue
 * and the full order page can never disagree.
 */
export function invalidateOrderSurfaces(qc: QueryClient, orderId?: string | null): void {
  void qc.invalidateQueries({ queryKey: ["orders-console"] });
  void qc.invalidateQueries({ queryKey: ["orders"] });
  void qc.invalidateQueries({ queryKey: ["verification-queue"] });
  void qc.invalidateQueries({ queryKey: ["verification-assignments"] });
  if (orderId) {
    void qc.invalidateQueries({ queryKey: ["order-quick-view", orderId] });
    void qc.invalidateQueries({ queryKey: ["order", orderId] });
    void qc.invalidateQueries({ queryKey: ["order-edit-block", orderId] });
    void qc.invalidateQueries({ queryKey: ["verification", orderId] });
    void qc.invalidateQueries({ queryKey: ["order-customer-intelligence", orderId] });
  } else {
    void qc.invalidateQueries({ queryKey: ["order-quick-view"] });
  }
}
