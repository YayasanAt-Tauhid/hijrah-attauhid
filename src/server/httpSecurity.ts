/** Baseline policy shared by Nitro responses and generated Cloudflare asset rules. */
export const securityHeaders = {
  "Content-Security-Policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; upgrade-insecure-requests",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=15552000",
} as const;

export function withSecurityHeaders(response: Response, pathname: string): Response {
  // Copy headers so redirects and other responses with immutable headers work too.
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (pathname.startsWith("/docs/") && !headers.has("X-Robots-Tag")) {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  // Keep the original body stream, status and cookies; do not buffer SSR responses.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
