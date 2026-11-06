import { createFileRoute } from "@tanstack/react-router";
import PersetujuanPembatalan from "@/pages/keuangan/PersetujuanPembatalan";

export const Route = createFileRoute("/_protected/_app/keuangan/persetujuan-pembatalan")({
  component: PersetujuanPembatalan,
});
