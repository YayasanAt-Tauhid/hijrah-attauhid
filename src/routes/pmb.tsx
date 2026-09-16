// Legacy alias: /pmb tetap dibuka agar callback pembayaran/link lama tidak putus.
// Komponen akan mengubah URL menjadi /spmb sambil mempertahankan query callback.
import { createFileRoute } from "@tanstack/react-router";
import SPMBDaftarOnlineV2 from "@/pages/portal/SPMBDaftarOnlineV2";

export const Route = createFileRoute("/pmb")({
  component: SPMBDaftarOnlineV2,
});
