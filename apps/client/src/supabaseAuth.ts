import { createClient, type AuthChangeEvent, type Session } from "@supabase/supabase-js";

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

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
