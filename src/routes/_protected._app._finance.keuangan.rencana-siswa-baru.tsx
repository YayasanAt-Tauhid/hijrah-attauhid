import { createFileRoute } from "@tanstack/react-router";
import RencanaTagihanSiswaBaru from "@/pages/keuangan/RencanaTagihanSiswaBaru";

export const Route = createFileRoute("/_protected/_app/_finance/keuangan/rencana-siswa-baru")({
  component: RencanaTagihanSiswaBaru,
});