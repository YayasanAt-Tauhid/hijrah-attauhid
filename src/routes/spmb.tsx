import { createFileRoute } from "@tanstack/react-router";
import SPMBDaftarOnline from "@/pages/portal/SPMBDaftarOnline";

export const Route = createFileRoute("/spmb")({
  component: SPMBDaftarOnline,
});
