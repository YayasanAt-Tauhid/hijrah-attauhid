import { createFileRoute } from "@tanstack/react-router";
import SPMB from "@/pages/akademik/SPMB";
import { SpmbVerificationOverview } from "@/components/akademik/SpmbVerificationOverview";

function SpmbPage() {
  return (
    <div className="space-y-6">
      <SpmbVerificationOverview />
      <SPMB />
    </div>
  );
}

export const Route = createFileRoute("/_protected/_app/akademik/spmb/")({
  component: SpmbPage,
});
