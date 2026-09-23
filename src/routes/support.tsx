import { createFileRoute } from "@tanstack/react-router";
import Support from "@/pages/Support";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Pusat Bantuan | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: Support,
});
