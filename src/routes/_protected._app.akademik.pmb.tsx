import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy alias: PMB -> SPMB.
export const Route = createFileRoute("/_protected/_app/akademik/pmb")({
  beforeLoad: () => {
    throw redirect({ to: "/akademik/spmb" });
  },
});
