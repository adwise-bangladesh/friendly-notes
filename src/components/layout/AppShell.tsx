import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="h-full">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
          <button
            aria-label="Close navigation"
            className="flex-1 bg-foreground/30"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onToggleSidebar={() => {
            if (window.matchMedia("(min-width: 768px)").matches) {
              setCollapsed((v) => !v);
            } else {
              setMobileOpen((v) => !v);
            }
          }}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
