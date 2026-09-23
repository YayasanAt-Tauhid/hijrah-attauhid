import { createFileRoute } from "@tanstack/react-router";
import PrivacyPolicy from "@/pages/PrivacyPolicy";

const PRIVACY_URL = "https://app.hijrah-attauhid.or.id/privacy-policy";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Kebijakan Privasi | Hijrah At-Tauhid" },
      {
        name: "description",
        content:
          "Kebijakan privasi Hijrah At-Tauhid mengenai pengelolaan data akademik, keuangan, kepegawaian, dan pembayaran.",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Kebijakan Privasi | Hijrah At-Tauhid" },
      { property: "og:url", content: PRIVACY_URL },
    ],
    links: [{ rel: "canonical", href: PRIVACY_URL }],
  }),
  component: PrivacyPolicy,
});
