import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const STAFF_ROLES = [
  "admin",
  "admin_tu",
  "kepala_sekolah",
  "guru",
  "keuangan",
  "siswa",
  "pustakawan",
  "kasir",
  "sekretaris_yayasan",
] as const;

export const Route = createFileRoute("/_protected")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  component: () => <ProtectedRoute allowedRoles={[...STAFF_ROLES]} />,
});
