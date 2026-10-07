import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "./middleware";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("middleware", () => {
  it("redirects unauthenticated users to /login", () => {
    const res = middleware(request("/"));
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("redirects unauthenticated users away from /history too", () => {
    const res = middleware(request("/history"));
    expect(res?.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets unauthenticated users reach /login", () => {
    expect(middleware(request("/login"))).toBeUndefined();
  });

  it("lets authenticated users through", () => {
    expect(
      middleware(request("/", "better-auth.session_token=abc")),
    ).toBeUndefined();
    expect(
      middleware(request("/history", "better-auth.session_token=abc")),
    ).toBeUndefined();
  });

  it("accepts the secure cookie variant", () => {
    expect(
      middleware(request("/", "__Secure-better-auth.session_token=abc")),
    ).toBeUndefined();
  });

  it("bounces authenticated users away from /login", () => {
    const res = middleware(request("/login", "better-auth.session_token=abc"));
    expect(res?.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("only guards the declared routes", () => {
    expect(config.matcher).toEqual(["/", "/history", "/login"]);
  });
});
