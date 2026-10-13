import { Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import AuthRecovery from "./AuthRecovery";
import AccessGateway from "@/pages/AccessGateway";

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
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

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, role, isLoading, authError, retryAuth } = useAuth();
  const location = useLocation();
  const isRoot = location.pathname === "/";

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (authError || (user && !role)) {
    return <AuthRecovery message={authError || "Akses akun belum tersedia. Silakan coba lagi atau hubungi admin sekolah."} onRetry={() => void retryAuth()} />;
  }

  if (!user) {
    return isRoot ? <AccessGateway /> : <Navigate to="/login" replace />;
  }

  if (role === "ortu" && isRoot) {
    return <Navigate to="/portal" replace />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    if (role === "ortu") {
      return <Navigate to="/portal" replace />;
    }
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
