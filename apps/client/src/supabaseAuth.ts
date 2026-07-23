import { createClient, type AuthChangeEvent, type Session } from "@supabase/supabase-js";

export function normalizePublicEnvValue(value: unknown) {
  const trimmed = String(value || "").trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed[trimmed.length - 1] === quote) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

const supabaseUrl = normalizePublicEnvValue(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = normalizePublicEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);

let supabaseClient: ReturnType<typeof createClient> | null = null;

export function isSupabaseAuthConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseClient() {
  if (!isSupabaseAuthConfigured()) return null;

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
        persistSession: true,
      },
    });
  }

  return supabaseClient;
}

export function getSupabaseRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

export function readSupabaseAuthTypeFromUrl() {
  const rawHash = window.location.hash.replace(/^#/, "");
  if (!rawHash || rawHash.startsWith("/")) return "";
  return new URLSearchParams(rawHash).get("type") || "";
}

export async function getActiveSupabaseSession() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session;
}

export function getSupabaseSessionExpiresAtMs(session: Session | null | undefined) {
  const expiresAtSeconds = Number(session?.expires_at || 0);
  return Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
    ? expiresAtSeconds * 1000
    : 0;
}

export function shouldRefreshSupabaseSession(
  session: Session | null | undefined,
  refreshLeewayMs = 5 * 60 * 1000,
) {
  const expiresAtMs = getSupabaseSessionExpiresAtMs(session);
  return Boolean(expiresAtMs && expiresAtMs - Date.now() <= refreshLeewayMs);
}

export async function refreshActiveSupabaseSession(refreshLeewayMs = 5 * 60 * 1000) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getSession();
  if (error) throw error;

  if (!data.session) return null;
  if (!shouldRefreshSupabaseSession(data.session, refreshLeewayMs)) {
    return data.session;
  }

  const { data: refreshedData, error: refreshError } = await client.auth.refreshSession(
    data.session,
  );
  if (refreshError) throw refreshError;
  return refreshedData.session;
}

export function onSupabaseAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  const client = getSupabaseClient();
  if (!client) return () => {};

  const { data } = client.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

export async function signOutSupabaseAuth() {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}

export async function signUpWithSupabase({ email, name, password }) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase authentication is not configured.");

  return client.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
      },
      emailRedirectTo: getSupabaseRedirectUrl(),
    },
  });
}

export async function signInWithSupabasePassword({ email, password }) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase authentication is not configured.");
  return client.auth.signInWithPassword({ email, password });
}

export async function resendSupabaseVerificationEmail(email: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase authentication is not configured.");

  return client.auth.resend({
    email,
    options: {
      emailRedirectTo: getSupabaseRedirectUrl(),
    },
    type: "signup",
  });
}

export async function requestSupabasePasswordReset(email: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase authentication is not configured.");

  return client.auth.resetPasswordForEmail(email, {
    redirectTo: getSupabaseRedirectUrl(),
  });
}

export async function updateSupabasePassword(password: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase authentication is not configured.");
  return client.auth.updateUser({ password });
}

export async function startSupabaseOAuth(provider: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase authentication is not configured.");

  const supabaseProvider = provider === "microsoft" ? "azure" : provider;
  const { error } = await client.auth.signInWithOAuth({
    provider: supabaseProvider as any,
    options: {
      redirectTo: getSupabaseRedirectUrl(),
      scopes: provider === "microsoft" ? "openid email profile" : undefined,
    },
  });

  if (error) throw error;
}
