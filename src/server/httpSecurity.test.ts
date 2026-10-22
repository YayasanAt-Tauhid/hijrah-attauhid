import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "./httpSecurity";

describe("HTTP security response defaults", () => {
  it.each([200, 404, 500])("protects status %s while retaining its body and status", async (status) => {
    const response = withSecurityHeaders(new Response("original body", { status }), "/missing");
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("original body");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
  });
  it("supports immutable redirect headers and preserves the redirect", () => {
    const response = withSecurityHeaders(Response.redirect("https://example.com/next", 302), "/redirect");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/next");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("preserves cookies, cache policy and an existing stricter CSP", () => {
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'", "X-Frame-Options": "DENY" });
    headers.append("Set-Cookie", "a=1; HttpOnly; Secure");
    headers.append("Set-Cookie", "b=2; HttpOnly; Secure");
    const response = withSecurityHeaders(new Response(null, { status: 204, headers }), "/api/test");
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
  it("applies crawler hints only to documentation", () => {
    expect(withSecurityHeaders(new Response("docs"), "/docs/integration-api").headers.get("X-Robots-Tag")).toContain("noindex");
    expect(withSecurityHeaders(new Response("home"), "/").headers.has("X-Robots-Tag")).toBe(false);
  });
});
