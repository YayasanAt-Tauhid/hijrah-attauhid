import { createFileRoute } from "@tanstack/react-router";
import SPMB from "@/pages/akademik/SPMB";

export const Route = createFileRoute("/_protected/_app/akademik/spmb")({
  component: SPMB,
});
