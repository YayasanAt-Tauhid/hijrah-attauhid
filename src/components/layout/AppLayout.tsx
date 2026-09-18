import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopNavbar } from "./TopNavbar";
import { Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";

export function AppLayout() {
  const { role, departemenId } = useAuth();
  const location = useLocation();

  if (role === "admin_tu") {
    if (!departemenId) return <Navigate to="/unauthorized" replace />;
    if (!location.pathname.startsWith("/akademik")) {
      return <Navigate to="/akademik" replace />;
    }
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full print:block print:min-h-0">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 print:block">
          <TopNavbar />
          <main className="flex-1 p-4 md:p-6 overflow-auto print:overflow-visible print:h-auto print:p-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
