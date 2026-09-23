import { createFileRoute } from "@tanstack/react-router";
import OAuthCallback from "@/pages/OAuthCallback";

export const Route = createFileRoute("/oauth-callback")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  component: OAuthCallback,
});
