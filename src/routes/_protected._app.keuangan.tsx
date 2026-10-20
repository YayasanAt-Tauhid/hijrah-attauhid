import { createFileRoute, useLocation } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import type { UserRole } from "@/contexts/AuthContext";

const FINANCE_ROLES: UserRole[] = ["admin", "keuangan", "kasir", "sekretaris_yayasan"];

function FinanceAccess() {
  const pathname = useLocation({ select: location => location.pathname });
  const isSpmbMonitor = pathname.replace(/\/+$/, "") === "/keuangan/monitoring-spmb";
  return <ProtectedRoute allowedRoles={isSpmbMonitor ? [...FINANCE_ROLES, "admin_tu"] : FINANCE_ROLES} />;
}

export const Route = createFileRoute("/_protected/_app/keuangan")({
  component: FinanceAccess,
});
