import { Navigate, Outlet, useMatches } from "@tanstack/react-router";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import type { PermissionKey } from "@/lib/permissions";
import AuthRecovery from "./AuthRecovery";
import AccessGateway from "@/pages/AccessGateway";

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  /**
   * Izin yang dibutuhkan (salah satu bila berupa daftar). Bila diberikan bersama
   * allowedRoles, akses cukup lewat salah satunya: peran di allowedRoles
   * (untuk peran di luar sistem izin, mis. admin_tu) atau izin.
   */
  permission?: PermissionKey | readonly PermissionKey[];
  /**
   * Izin dicari dari alamat halaman. Alamat yang tidak dikenal hanya untuk admin
   * (gagal tertutup), sehingga rute baru tidak terbuka karena lupa dipetakan.
   */
  resolvePermission?: (pathname: string) => PermissionKey | readonly PermissionKey[] | null;
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Memuat...</p>
      </div>
    </div>
  );
}

export function ProtectedRoute({ allowedRoles, permission, resolvePermission }: ProtectedRouteProps) {
  const { user, role, isLoading, authError, retryAuth, can, permissionsLoading } = useAuth();
  // The URL changes before the destination is presented. Use the rendered
  // matches so leaving the home gateway cannot trigger a staff-login redirect
  // while a public page (such as parent login) is still loading.
  const pathname = useMatches({ select: matches => matches[matches.length - 1]?.pathname });
  const isRoot = pathname === "/";

  if (isLoading) {
    return <LoadingScreen />;
  }

  // An account created through the wrong Google entry point can be signed in
  // without a school role. Keep both entry choices available at home.
  if (isRoot && user && !role && !authError) return <AccessGateway />;

  if (authError || (user && !role)) {
    return <AuthRecovery message={authError || "Akses akun belum tersedia. Silakan coba lagi atau hubungi admin sekolah."} onRetry={() => void retryAuth()} />;
  }

  if (!user) {
    return isRoot ? <AccessGateway /> : <Navigate to="/login" replace />;
  }

  if (role === "ortu" && isRoot) {
    return <Navigate to="/portal" replace />;
  }

  if (permission || resolvePermission) {
    if (allowedRoles && role && allowedRoles.includes(role)) return <Outlet />;
    // Izin peran yang bisa diatur dimuat setelah peran; jangan putuskan akses sebelum tiba.
    if (permissionsLoading) return <LoadingScreen />;
    const required = permission ?? resolvePermission?.(pathname ?? "") ?? null;
    const keys = required ? (Array.isArray(required) ? required : [required]) : [];
    const allowed = keys.length > 0 ? keys.some((key) => can(key)) : role === "admin";
    if (!allowed) {
      return <Navigate to={role === "ortu" ? "/portal" : "/unauthorized"} replace />;
    }
    return <Outlet />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    if (role === "ortu") {
      return <Navigate to="/portal" replace />;
    }
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
