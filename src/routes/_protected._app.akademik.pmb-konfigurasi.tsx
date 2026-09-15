import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/_app/akademik/pmb-konfigurasi")({
  beforeLoad: () => {
    throw redirect({ to: "/akademik/spmb-konfigurasi" });
  },
});
