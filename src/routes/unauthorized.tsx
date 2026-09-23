import { createFileRoute } from "@tanstack/react-router";
import Unauthorized from "@/pages/Unauthorized";

export const Route = createFileRoute("/unauthorized")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  component: Unauthorized,
});
