import { createFileRoute } from "@tanstack/react-router";
import HakAksesPeran from "@/pages/pengaturan/HakAksesPeran";

export const Route = createFileRoute("/_protected/_app/pengaturan/hak-akses")({
  component: HakAksesPeran,
});
