import { createFileRoute } from "@tanstack/react-router";
import PMBDaftarOnline from "@/pages/portal/PMBDaftarOnline";

export const Route = createFileRoute("/pmb")({
  component: PMBDaftarOnline,
});
