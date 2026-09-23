import { createFileRoute } from "@tanstack/react-router";
import PortalOAuthCallback from "@/pages/portal/PortalOAuthCallback";

export const Route = createFileRoute("/portal/oauth-callback")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  component: PortalOAuthCallback,
});
