import { afterEach, describe, expect, it } from "vitest";
import {
  buildOAuthAuthorizationUrl,
  buildOAuthCallbackUrl,
  getOAuthProviderConfig,
  isEmailAllowedForMicrosoft,
} from "../../apps/server/oauth.ts";

const originalEnv = { ...process.env };

function mockRequest() {
  return {
    get(name: string) {
      return name.toLowerCase() === "host" ? "127.0.0.1:4000" : "";
    },
    headers: {
      "x-forwarded-proto": "http",
    },
    protocol: "http",
  };
}

describe("OAuth helpers", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // Microsoft sign-in is intentionally constrained to NUS school/organization
  // addresses, including school subdomains under nus.edu.sg.
  it("allows NUS Microsoft email domains and rejects unrelated domains", () => {
    expect(isEmailAllowedForMicrosoft("student@u.nus.edu")).toBe(true);
    expect(isEmailAllowedForMicrosoft("staff@comp.nus.edu.sg")).toBe(true);
    expect(isEmailAllowedForMicrosoft("person@gmail.com")).toBe(false);
    expect(isEmailAllowedForMicrosoft("person@hotmail.com", ["*"])).toBe(true);
  });

  // Provider setup depends on exact callback URLs. This test keeps the generated
  // authorization URL aligned with the callbacks shown in .env.example.
  it("builds Google authorization URLs with the app callback route", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
    process.env.OAUTH_PUBLIC_BASE_URL = "http://127.0.0.1:4000";

    const config = getOAuthProviderConfig("google");
    const callbackUrl = buildOAuthCallbackUrl(mockRequest(), "google");
    const authorizationUrl = new URL(buildOAuthAuthorizationUrl(config, callbackUrl, "signed-state"));

    expect(callbackUrl).toBe("http://127.0.0.1:4000/api/auth/oauth/google/callback");
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorizationUrl.searchParams.get("client_id")).toBe("google-client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(callbackUrl);
    expect(authorizationUrl.searchParams.get("scope")).toContain("openid");
    expect(authorizationUrl.searchParams.get("state")).toBe("signed-state");
  });

  it("allows provider-specific callback bases for Microsoft localhost redirects", () => {
    process.env.OAUTH_PUBLIC_BASE_URL = "http://127.0.0.1:4000";
    process.env.MICROSOFT_OAUTH_PUBLIC_BASE_URL = "http://localhost:4000";

    expect(buildOAuthCallbackUrl(mockRequest(), "google")).toBe(
      "http://127.0.0.1:4000/api/auth/oauth/google/callback",
    );
    expect(buildOAuthCallbackUrl(mockRequest(), "microsoft")).toBe(
      "http://localhost:4000/api/auth/oauth/microsoft/callback",
    );
  });
});
