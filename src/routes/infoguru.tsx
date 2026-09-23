import { createFileRoute } from "@tanstack/react-router";
import InfoGuru from "@/pages/InfoGuru";

export const Route = createFileRoute("/infoguru")({
  head: () => ({
    meta: [
      { title: "InfoGuru | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: InfoGuru,
});
