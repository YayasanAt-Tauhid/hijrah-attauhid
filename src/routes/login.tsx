import { createFileRoute } from "@tanstack/react-router";
import Login from "@/pages/Login";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: Login,
});
