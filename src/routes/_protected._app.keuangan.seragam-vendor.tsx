import { createFileRoute } from "@tanstack/react-router";
import BiayaSeragamSPMB from "@/pages/keuangan/BiayaSeragamSPMB";

export const Route = createFileRoute("/_protected/_app/keuangan/seragam-vendor")({
  component: BiayaSeragamSPMB,
});
