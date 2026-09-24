import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export const Route = createFileRoute("/_protected/_app/keuangan")({
  component: () => (
    <ProtectedRoute
      allowedRoles={["admin", "keuangan", "kasir", "sekretaris_yayasan"]}
    />
  ),
});
