import { describe, expect, it } from "vitest";

import { normalizePublicEnvValue } from "../../apps/client/src/supabaseAuth.ts";

describe("Supabase auth environment handling", () => {
  it("trims whitespace and strips matching env quote wrappers", () => {
    expect(normalizePublicEnvValue(" 'https://example.supabase.co' ")).toBe(
      "https://example.supabase.co",
    );
    expect(normalizePublicEnvValue(' "sb_publishable_test" ')).toBe("sb_publishable_test");
  });

  it("leaves unquoted values unchanged", () => {
    expect(normalizePublicEnvValue("https://example.supabase.co")).toBe(
      "https://example.supabase.co",
    );
  });
});
