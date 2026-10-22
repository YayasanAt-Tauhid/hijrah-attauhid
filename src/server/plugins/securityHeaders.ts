import { definePlugin } from "nitro";
import { withSecurityHeaders } from "../httpSecurity";

export default definePlugin((app) => {
  const fetch = app.fetch;
  // Route rules alone miss framework-generated error responses.
  app.fetch = async (request) =>
    withSecurityHeaders(await fetch(request), new URL(request.url).pathname);
});
