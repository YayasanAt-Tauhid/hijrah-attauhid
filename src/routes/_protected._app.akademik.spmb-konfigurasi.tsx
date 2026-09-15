import { createFileRoute } from "@tanstack/react-router";
import KonfigurasiPMB from "@/pages/akademik/KonfigurasiPMB";

export const Route = createFileRoute("/_protected/_app/akademik/spmb-konfigurasi")({
  component: KonfigurasiPMB,
});
