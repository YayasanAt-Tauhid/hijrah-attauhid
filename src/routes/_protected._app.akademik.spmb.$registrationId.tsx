import { createFileRoute } from "@tanstack/react-router";
import DetailSPMB from "@/pages/akademik/DetailSPMB";

export const Route = createFileRoute("/_protected/_app/akademik/spmb/$registrationId")({
  component: DetailSPMB,
});
