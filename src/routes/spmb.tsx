import { createFileRoute } from "@tanstack/react-router";
import SPMBDaftarOnlineV2 from "@/pages/portal/SPMBDaftarOnlineV2";

const SPMB_URL = "https://app.hijrah-attauhid.or.id/spmb";

export const Route = createFileRoute("/spmb")({
  head: () => ({
    meta: [
      { title: "SPMB 2027/2028 At-Tauhid | Pendaftaran Murid Baru" },
      {
        name: "description",
        content:
          "Pendaftaran SPMB At-Tauhid tahun ajaran 2027/2028 untuk TK, SD, SMP, SMA, dan MTA. Isi formulir pendaftaran calon murid secara online.",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "SPMB 2027/2028 At-Tauhid" },
      {
        property: "og:description",
        content:
          "Pendaftaran murid baru At-Tauhid tahun ajaran 2027/2028 untuk TK, SD, SMP, SMA, dan MTA.",
      },
      { property: "og:url", content: SPMB_URL },
    ],
    links: [{ rel: "canonical", href: SPMB_URL }],
  }),
  component: SPMBDaftarOnlineV2,
});
