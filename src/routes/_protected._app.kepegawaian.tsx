import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export const Route = createFileRoute("/_protected/_app/kepegawaian")({
  component: () => <ProtectedRoute allowedRoles={["admin"]} />,
});
