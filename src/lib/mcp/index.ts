import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProducts from "./tools/list-products";
import getProduct from "./tools/get-product";
import listOrders from "./tools/list-orders";
import getOrder from "./tools/get-order";
import addOrderNote from "./tools/add-order-note";
import inventoryOverview from "./tools/inventory-overview";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "commerce-operations",
  title: "Commerce Operations",
  version: "0.1.0",
  instructions:
    "Tools for the Commerce Operations dashboard. Read the product catalog, inventory stock levels and orders, and append internal notes to an order. All access runs as the signed-in team member, so results respect that user's permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  // Cast: the SDK's tool type requires `outputSchema` under
  // exactOptionalPropertyTypes; these tools intentionally omit it.
  tools: [
    listProducts,
    getProduct,
    listOrders,
    getOrder,
    addOrderNote,
    inventoryOverview,
  ] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
