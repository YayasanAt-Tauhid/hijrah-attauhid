import { createFileRoute } from "@tanstack/react-router";
import MonitoringPembayaranSPMB from "@/pages/keuangan/MonitoringPembayaranSPMB";

export const Route = createFileRoute("/_protected/_app/keuangan/monitoring-spmb")({
  component: MonitoringPembayaranSPMB,
});
