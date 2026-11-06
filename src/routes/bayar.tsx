import { createFileRoute } from "@tanstack/react-router";
import BayarLink from "@/pages/portal/BayarLink";

// Halaman publik link pembayaran orang tua. Token berada di fragment URL (#),
// tidak dikirim ke server. no-referrer mencegah alamat halaman bocor ke situs lain.
export const Route = createFileRoute("/bayar")({
  head: () => ({
    meta: [
      { title: "Pembayaran Tagihan | Hijrah At-Tauhid" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: BayarLink,
});
