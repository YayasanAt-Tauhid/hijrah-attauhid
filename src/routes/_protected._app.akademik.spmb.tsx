import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/_app/akademik/spmb")({
  component: Outlet,
});
