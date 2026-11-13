import { createFileRoute } from "@tanstack/react-router";
import SeragamSiswa from "@/pages/akademik/SeragamSiswa";

export const Route = createFileRoute("/_protected/_app/akademik/seragam")({
  component: SeragamSiswa,
});
