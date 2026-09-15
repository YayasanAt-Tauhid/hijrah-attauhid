import { createFileRoute } from "@tanstack/react-router";
import PMB from "@/pages/akademik/PMB";

// Halaman administrasi SPMB. Nama komponen internal PMB dipertahankan agar
// perubahan istilah tidak memutus import lama.
export const Route = createFileRoute("/_protected/_app/akademik/spmb")({
  component: PMB,
});
