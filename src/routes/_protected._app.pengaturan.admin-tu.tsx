import { createFileRoute } from "@tanstack/react-router";
import AdminTuAkademik from "@/pages/pengaturan/AdminTuAkademik";

export const Route = createFileRoute("/_protected/_app/pengaturan/admin-tu")({
  component: AdminTuAkademik,
});
