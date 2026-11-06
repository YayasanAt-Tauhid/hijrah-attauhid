import { createFileRoute, useLocation } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PERMISSION_KEYS, permissionForPath } from "@/lib/permissions";

// Halaman Keuangan di luar layout _finance (kasir, SPMB, diskon). Dijaga izin per
// alamat; beranda Keuangan terbuka bagi siapa pun yang punya izin Keuangan apa
// pun. Admin TU hanya boleh membaca monitoring SPMB (di luar sistem izin).
function FinanceAccess() {
  const pathname = useLocation({ select: location => location.pathname });
  const path = pathname.replace(/\/+$/, "");
  const isLanding = path === "/keuangan";
  const isSpmbMonitor = path === "/keuangan/monitoring-spmb";
  return (
    <ProtectedRoute
      allowedRoles={isSpmbMonitor ? ["admin_tu"] : undefined}
      permission={isLanding ? PERMISSION_KEYS : undefined}
      resolvePermission={isLanding ? undefined : permissionForPath}
    />
  );
}

export const Route = createFileRoute("/_protected/_app/keuangan")({
  component: FinanceAccess,
});
