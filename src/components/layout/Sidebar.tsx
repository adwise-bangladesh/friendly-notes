import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { APP_CONFIG } from "@/lib/app-config";
import { NAV_ITEMS } from "./nav-items";

interface SidebarProps {
  collapsed: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ collapsed, onNavigate }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (to: string) =>
    to === "/products" ? pathname === "/products" : pathname === to || pathname.startsWith(to + "/");

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">
          {APP_CONFIG.shortName}
        </div>
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight">{APP_CONFIG.name}</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            const showChildren =
              !collapsed && item.children && pathname.startsWith(item.to);

            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>

                {showChildren && (
                  <ul className="mt-0.5 mb-1 space-y-0.5 border-l border-sidebar-border pl-3 ml-4">
                    {item.children!.map((child) => (
                      <li key={child.to}>
                        <Link
                          to={child.to}
                          onClick={onNavigate}
                          className={cn(
                            "block rounded px-2.5 py-1.5 text-[12.5px] transition-colors",
                            pathname === child.to
                              ? "text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-foreground/50">
          Bangladesh operations · MVP
        </div>
      )}
    </aside>
  );
}
