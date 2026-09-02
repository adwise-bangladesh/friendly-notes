import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Boxes,
  Radar,
  Banknote,
  BarChart3,
  Truck,
  Users,
  RotateCcw,
  Zap,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";


export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  children?: { label: string; to: string }[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  {
    label: "Analytics",
    to: "/analytics",
    icon: BarChart3,
    children: [
      { label: "Business Overview", to: "/analytics" },
      { label: "Orders & Delivery", to: "/analytics/operations" },
      { label: "Customers", to: "/analytics/customers" },
      { label: "Products & Inventory", to: "/analytics/products" },
      { label: "Procurement", to: "/analytics/procurement" },
    ],
  },

  {
    label: "Operations",
    to: "/operations",
    icon: Radar,
    children: [
      { label: "Command Center", to: "/operations" },
      { label: "My Work", to: "/operations/my-work" },
    ],
  },
  {
    label: "Orders",
    to: "/orders",
    icon: ShoppingCart,
    children: [
      { label: "All Orders", to: "/orders" },
      { label: "Verification", to: "/orders/verification" },
      { label: "Warehouse", to: "/orders/fulfillment" },
      { label: "Shipping", to: "/orders/shipments" },
      { label: "Exceptions", to: "/orders/exceptions" },
    ],
  },
  {
    label: "Products",
    to: "/products",
    icon: Package,
    children: [
      { label: "All Products", to: "/products" },
      { label: "Categories", to: "/products/categories" },
      { label: "Brands", to: "/products/brands" },
    ],
  },
  {
    label: "Inventory",
    to: "/inventory",
    icon: Boxes,
    children: [
      { label: "Stock Overview", to: "/inventory" },
      { label: "Movements", to: "/inventory/movements" },
      { label: "Transfers", to: "/inventory/transfers" },
      { label: "Stocktakes", to: "/inventory/stocktakes" },
      { label: "Locations", to: "/inventory/locations" },
    ],
  },
  {
    label: "Finance",
    to: "/finance/courier-settlements",
    icon: Banknote,
    children: [{ label: "Courier Settlements", to: "/finance/courier-settlements" }],
  },
  {
    label: "Procurement",
    to: "/procurement/purchase-orders",
    icon: Truck,
    children: [
      { label: "Purchase Orders", to: "/procurement/purchase-orders" },
      { label: "Suppliers", to: "/suppliers" },
    ],
  },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Returns", to: "/returns", icon: RotateCcw },
  {
    label: "Automation",
    to: "/automation",
    icon: Zap,
    children: [
      { label: "Rules", to: "/automation" },
      { label: "History", to: "/automation/executions" },
    ],
  },
  {
    label: "Integrations",
    to: "/integrations",
    icon: Plug,
    children: [
      { label: "Overview", to: "/integrations" },
      { label: "Activity", to: "/integrations/logs" },
    ],
  },
  { label: "Settings", to: "/settings", icon: Settings },
];
