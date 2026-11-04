import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { permissionForPath } from "@/lib/permissions";

// Setiap halaman Keuangan di bawah layout ini dijaga izin per alamat
// (lihat PATH_PERMISSIONS); alamat yang belum dipetakan hanya untuk admin.
export const Route = createFileRoute("/_protected/_app/_finance")({
  component: () => <ProtectedRoute resolvePermission={permissionForPath} />,
});
