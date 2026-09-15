import { createFileRoute } from "@tanstack/react-router";
import PembayaranPMB from "@/pages/keuangan/PembayaranPMB";

export const Route = createFileRoute("/_protected/_app/_finance/keuangan/pembayaran-spmb")({
  component: PembayaranPMB,
});
