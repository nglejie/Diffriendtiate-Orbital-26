export function userUsesSupabaseAuth(user) {
  return Array.isArray(user?.authProviders) && user.authProviders.includes("supabase");
}

function readJwtPayload(tokenValue) {
  const [, payload] = String(tokenValue || "").split(".");
  if (!payload || typeof globalThis.atob !== "function") return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function readJwtExpiresAtMs(tokenValue) {
  const expiresAtSeconds = Number(readJwtPayload(tokenValue)?.exp || 0);
  return Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
    ? expiresAtSeconds * 1000
    : 0;
}

export function looksLikeSupabaseAccessToken(tokenValue) {
  const payload = readJwtPayload(tokenValue);
  return (
    String(payload?.iss || "").includes("supabase") ||
    (payload?.aud === "authenticated" && typeof payload?.role === "string")
  );
}

export function usesSupabaseBrowserSession(user, tokenValue) {
  return userUsesSupabaseAuth(user) && looksLikeSupabaseAccessToken(tokenValue);
}
