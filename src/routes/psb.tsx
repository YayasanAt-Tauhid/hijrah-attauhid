import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy: PSB -> SPMB.
export const Route = createFileRoute("/psb")({
  beforeLoad: () => {
    throw redirect({ to: "/spmb" });
  },
});
