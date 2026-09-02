import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { APP_CONFIG } from "@/lib/app-config";
import { useProfile } from "@/hooks/use-profile";
import { ROLE_LABELS } from "@/types/profile";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Commerce Operations" },
      { name: "description", content: "Account profile, role and workspace settings." },
    ],
  }),
  component: SettingsPage,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5 last:border-0">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-medium">{value}</span>
    </div>
  );
}

function SettingsPage() {
  const { data: profile, isLoading } = useProfile();

  return (
    <>
      <PageHeader title="Settings" description="Your account and workspace information." />

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card">
          <header className="border-b border-border px-3 py-2">
            <h2 className="text-[12.5px] font-semibold tracking-tight">Your profile</h2>
          </header>
          {isLoading ? (
            <LoadingState rows={3} />
          ) : (
            <div>
              <Row label="Name" value={profile?.full_name ?? "—"} />
              <Row
                label="Role"
                value={
                  profile ? <StatusBadge tone="info">{ROLE_LABELS[profile.role]}</StatusBadge> : "—"
                }
              />
              <Row
                label="Member since"
                value={
                  profile ? new Date(profile.created_at).toLocaleDateString("en-GB") : "—"
                }
              />
            </div>
          )}
        </section>

        <section className="rounded-md border border-border bg-card">
          <header className="border-b border-border px-3 py-2">
            <h2 className="text-[12.5px] font-semibold tracking-tight">Workspace</h2>
          </header>
          <Row label="Application" value={APP_CONFIG.name} />
          <Row label="Market" value="Bangladesh" />
          <Row label="Stage" value={<StatusBadge tone="warning">Foundation (Step 1)</StatusBadge>} />
        </section>
      </div>
    </>
  );
}
