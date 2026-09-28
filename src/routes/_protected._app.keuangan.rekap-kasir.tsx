import { createFileRoute } from "@tanstack/react-router";
import RekapKasirSaya from "@/pages/keuangan/RekapKasirSaya";

export const Route = createFileRoute("/_protected/_app/keuangan/rekap-kasir")({
  component: RekapKasirSaya,
});