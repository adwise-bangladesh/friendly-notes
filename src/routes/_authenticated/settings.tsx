import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_CONFIG } from "@/lib/app-config";
import { useProfile } from "@/hooks/use-profile";
import { ROLE_LABELS, type AppRole } from "@/types/profile";
import {
  assignUserRole,
  fetchRoleHistory,
  fetchWorkspaceUsers,
  revokeUserRole,
} from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings & team roles · Commerce Operations" },
      {
        name: "description",
        content:
          "Your account profile, workspace information and controlled team role administration.",
      },
      { property: "og:title", content: "Settings & team roles · Commerce Operations" },
      {
        property: "og:description",
        content: "Manage your profile and assign team roles for the operations workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

const ASSIGNABLE: AppRole[] = ["viewer", "staff", "admin", "owner"];

function SettingsPage() {
  const { data: profile, isLoading } = useProfile();
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";

  return (
    <>
      <PageHeader title="Settings" description="Your account, workspace and team access." />

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
                value={profile ? new Date(profile.created_at).toLocaleDateString("en-GB") : "—"}
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
          <Row label="Stage" value={<StatusBadge tone="warning">Operations</StatusBadge>} />
        </section>
      </div>

      {isAdmin ? <TeamRoles currentUserId={profile?.id ?? ""} isOwner={profile?.role === "owner"} /> : null}
    </>
  );
}

function TeamRoles({ currentUserId, isOwner }: { currentUserId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const users = useQuery({ queryKey: ["workspace-users"], queryFn: fetchWorkspaceUsers });
  const history = useQuery({ queryKey: ["role-history"], queryFn: () => fetchRoleHistory(15) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["workspace-users"] });
    void qc.invalidateQueries({ queryKey: ["role-history"] });
  };

  const assign = useMutation({
    mutationFn: (input: { userId: string; role: AppRole }) =>
      assignUserRole(input.userId, input.role, reason || undefined),
    onSuccess: () => {
      setReason("");
      refresh();
      toast.success("Role updated");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "The role change was rejected"),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) => revokeUserRole(userId, reason || undefined),
    onSuccess: () => {
      setReason("");
      refresh();
      toast.success("Role revoked");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "The role change was rejected"),
  });

  const busy = assign.isPending || revoke.isPending;

  return (
    <section className="mt-3 rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <h2 className="text-[12.5px] font-semibold tracking-tight">Team roles</h2>
          <p className="text-[11.5px] text-muted-foreground">
            New accounts start with no role and cannot use the workspace until one is granted.
          </p>
        </div>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (recorded in role history)"
          className="h-8 w-64 text-[13px]"
        />
      </header>

      {users.isLoading ? (
        <LoadingState rows={3} />
      ) : (
        <div className="divide-y divide-border">
          {(users.data ?? []).map((u) => {
            const isSelf = u.user_id === currentUserId;
            const ownerLocked = u.role === "owner" && !isOwner;
            return (
              <div
                key={u.user_id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{u.full_name ?? "Unnamed user"}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    Joined {new Date(u.joined_at).toLocaleDateString("en-GB")}
                    {isSelf ? " · you" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={u.role ? "info" : "warning"}>
                    {u.role ? ROLE_LABELS[u.role] : "No role"}
                  </StatusBadge>
                  <Select
                    value={u.role ?? ""}
                    disabled={isSelf || ownerLocked || busy}
                    onValueChange={(value) =>
                      assign.mutate({ userId: u.user_id, role: value as AppRole })
                    }
                  >
                    <SelectTrigger className="h-8 w-32 text-[13px]">
                      <SelectValue placeholder="Assign role" />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE.filter((r) => r !== "owner" || isOwner).map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isSelf || ownerLocked || !u.role || busy}
                    onClick={() => revoke.mutate(u.user_id)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-border px-3 py-2">
        <h3 className="mb-1 text-[11.5px] font-semibold text-muted-foreground">Role history</h3>
        {(history.data ?? []).length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No role changes recorded yet.</p>
        ) : (
          <ul className="space-y-1">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="text-[12px] text-muted-foreground">
                {new Date(h.created_at).toLocaleString("en-GB")} · {h.action}{" "}
                {h.role_from ? `from ${ROLE_LABELS[h.role_from]} ` : ""}
                {h.role_to ? `to ${ROLE_LABELS[h.role_to]}` : ""}
                {h.reason ? ` — ${h.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
