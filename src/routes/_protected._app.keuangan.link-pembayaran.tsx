import { createFileRoute } from "@tanstack/react-router";
import LinkPembayaran from "@/pages/keuangan/LinkPembayaran";

export const Route = createFileRoute("/_protected/_app/keuangan/link-pembayaran")({
  component: LinkPembayaran,
});
