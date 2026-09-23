import { createFileRoute } from "@tanstack/react-router";
import PortalLogin from "@/pages/portal/PortalLogin";

export const Route = createFileRoute("/portal/login")({
  head: () => ({
    meta: [
      { title: "Portal Orang Tua | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: PortalLogin,
});
