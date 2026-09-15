import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/_app/_finance/keuangan/pembayaran-pmb")({
  beforeLoad: () => {
    throw redirect({ to: "/keuangan/pembayaran-spmb" });
  },
});
