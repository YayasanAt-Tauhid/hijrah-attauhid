// Legacy alias: /pmb tetap dibuka agar callback pembayaran/link lama tidak putus.
// Komponen akan mengubah URL menjadi /spmb sambil mempertahankan query callback.
import { createFileRoute } from "@tanstack/react-router";
import SPMBDaftarOnlineV2 from "@/pages/portal/SPMBDaftarOnlineV2";

export const Route = createFileRoute("/pmb")({
  head: () => ({
    meta: [
      { title: "SPMB At-Tauhid" },
      { name: "robots", content: "noindex, follow" },
    ],
    links: [{ rel: "canonical", href: "https://app.hijrah-attauhid.or.id/spmb" }],
  }),
  component: SPMBDaftarOnlineV2,
});
