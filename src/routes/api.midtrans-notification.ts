import { createFileRoute } from "@tanstack/react-router";
import { handleNotification } from "@/server/midtransNotification";
export const Route = createFileRoute("/api/midtrans-notification")({
  server: { handlers: { POST: ({ request }) => handleNotification(request) } },
});
