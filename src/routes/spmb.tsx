import { createFileRoute } from "@tanstack/react-router";
import SPMBDaftarOnlineV2 from "@/pages/portal/SPMBDaftarOnlineV2";

export const Route = createFileRoute("/spmb")({
  component: SPMBDaftarOnlineV2,
});
