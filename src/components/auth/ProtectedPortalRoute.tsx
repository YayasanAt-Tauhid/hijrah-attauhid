import { Navigate, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import AuthRecovery from "./AuthRecovery";

export default function ProtectedPortalRoute() {
  const { user, role, isLoading, authError, retryAuth } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Memuat...</p>
        </div>
      </div>
    );
  }
  if (authError || (user && !role)) {
    return <AuthRecovery message={authError || "Akses akun belum tersedia. Silakan coba lagi atau hubungi admin sekolah."} onRetry={() => void retryAuth()} />;
  }
  if (!user || role !== "ortu") return <Navigate to="/portal/login" replace />;
  return <Outlet />;
}
