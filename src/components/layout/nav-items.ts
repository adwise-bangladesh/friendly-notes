import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Boxes,
  Users,
  RotateCcw,
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
    label: "Orders",
    to: "/orders",
    icon: ShoppingCart,
    children: [
      { label: "All Orders", to: "/orders" },
      { label: "Verification", to: "/orders/verification" },
      { label: "Warehouse", to: "/orders/fulfillment" },
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
      { label: "Locations", to: "/inventory/locations" },
    ],
  },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Returns", to: "/returns", icon: RotateCcw },
  { label: "Settings", to: "/settings", icon: Settings },
];
