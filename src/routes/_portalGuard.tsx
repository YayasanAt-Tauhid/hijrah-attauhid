import { createFileRoute } from "@tanstack/react-router";
import ProtectedPortalRoute from "@/components/auth/ProtectedPortalRoute";

export const Route = createFileRoute("/_portalGuard")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  component: ProtectedPortalRoute,
});
