import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_CONFIG } from "@/lib/app-config";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Commerce Operations" },
      {
        name: "description",
        content: "Sign in to the Commerce Operations dashboard to manage ecommerce operations.",
      },
      { property: "og:title", content: "Sign in · Commerce Operations" },
      {
        property: "og:description",
        content: "Secure sign-in for the Commerce Operations ecommerce dashboard.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: "/dashboard", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
            {APP_CONFIG.shortName}
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">{APP_CONFIG.name}</p>
            <p className="text-[11px] text-muted-foreground">{APP_CONFIG.tagline}</p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-5">
          <h1 className="text-base font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Access is restricted to team accounts.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9"
              />
            </div>

            {error && (
              <p className="rounded border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-[12.5px] text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="h-9 w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11.5px] text-muted-foreground">
          Accounts are created by an owner or admin. Public sign-up is disabled.
        </p>
      </div>
    </div>
  );
}
