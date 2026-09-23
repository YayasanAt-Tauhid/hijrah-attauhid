import { createFileRoute } from "@tanstack/react-router";
import Anjungan from "@/pages/Anjungan";

export const Route = createFileRoute("/anjungan")({
  head: () => ({
    meta: [
      { title: "Anjungan Informasi | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: Anjungan,
});
