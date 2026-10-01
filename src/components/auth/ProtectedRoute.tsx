import { Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth, UserRole } from "@/contexts/AuthContext";
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
  const { user, role, isLoading } = useAuth();
  const location = useLocation();
  const isRoot = location.pathname === "/";

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return isRoot ? <AccessGateway /> : <Navigate to="/login" replace />;
  }

  // Fail closed: setelah sesi user tersedia, role bisa masih null beberapa saat
  // karena users_profile diambil secara async. Jangan pernah merender route yang
  // dibatasi role sebelum role tersebut benar-benar sudah ter-resolve.
  if (allowedRoles && !role) {
    return <LoadingScreen />;
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
