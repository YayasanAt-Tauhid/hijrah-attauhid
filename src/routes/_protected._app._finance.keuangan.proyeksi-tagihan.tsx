import { createFileRoute } from "@tanstack/react-router";
import ProyeksiTagihan from "@/pages/keuangan/ProyeksiTagihan";

export const Route = createFileRoute("/_protected/_app/_finance/keuangan/proyeksi-tagihan")({
  component: ProyeksiTagihan,
});
