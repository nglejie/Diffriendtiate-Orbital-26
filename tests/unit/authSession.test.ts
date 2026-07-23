import { describe, expect, it } from "vitest";
import {
  looksLikeSupabaseAccessToken,
  readJwtExpiresAtMs,
  usesSupabaseBrowserSession,
} from "../../apps/client/src/authSession.ts";

function tokenWithPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encoded}.signature`;
}

describe("client auth session helpers", () => {
  it("detects Supabase browser sessions from the active token, not linked providers alone", () => {
    const user = {
      authProviders: ["supabase", "google"],
    };
    const appJwt = tokenWithPayload({
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: "usr_1",
    });
    const supabaseJwt = tokenWithPayload({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: "https://project.supabase.co/auth/v1",
      role: "authenticated",
      sub: "supabase-user",
    });

    expect(looksLikeSupabaseAccessToken(appJwt)).toBe(false);
    expect(usesSupabaseBrowserSession(user, appJwt)).toBe(false);
    expect(usesSupabaseBrowserSession(user, supabaseJwt)).toBe(true);
  });

  it("reads JWT expiry timestamps when present", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;

    expect(readJwtExpiresAtMs(tokenWithPayload({ exp }))).toBe(exp * 1000);
    expect(readJwtExpiresAtMs("not-a-jwt")).toBe(0);
  });
});
