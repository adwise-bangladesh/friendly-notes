import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Commerce Operations · Ecommerce Operations Dashboard" },
      {
        name: "description",
        content:
          "Commerce Operations is a compact ecommerce operations dashboard for Bangladesh-focused retail teams.",
      },
      { property: "og:title", content: "Commerce Operations" },
      {
        property: "og:description",
        content: "Compact ecommerce operations dashboard for Bangladesh-focused retail teams.",
      },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth" });
  },
  component: () => null,
});
