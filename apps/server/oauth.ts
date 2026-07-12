import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export const OAUTH_PROVIDER_IDS = ["google", "github", "microsoft"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

type OAuthProviderConfig = {
  authorizationUrl: string;
  clientId: string;
  clientSecret: string;
  extraAuthorizationParams?: Record<string, string>;
  id: OAuthProviderId;
  label: string;
  scopes: string[];
  tokenUrl: string;
};

export type OAuthProfile = {
  email: string;
  name: string;
  provider: OAuthProviderId;
  providerUserId: string;
};

const DEFAULT_MICROSOFT_ALLOWED_EMAIL_DOMAINS = ["nus.edu.sg", "u.nus.edu"];

function readFirstEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function firstForwardedHeader(value: unknown) {
  const header = Array.isArray(value) ? value[0] : value;
  return String(header || "").split(",")[0].trim();
}

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function ensureProviderId(value: string): OAuthProviderId | null {
  return OAUTH_PROVIDER_IDS.includes(value as OAuthProviderId)
    ? (value as OAuthProviderId)
    : null;
}

export function normalizeOAuthProvider(value: unknown) {
  return ensureProviderId(String(value || "").trim().toLowerCase());
}

export function getMicrosoftAllowedEmailDomains() {
  const configured = String(process.env.MICROSOFT_ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_MICROSOFT_ALLOWED_EMAIL_DOMAINS;
}

export function isEmailAllowedForMicrosoft(email: string, allowedDomains = getMicrosoftAllowedEmailDomains()) {
  const domain = normalizeEmail(email).split("@")[1] || "";
  if (!domain) return false;
  if (allowedDomains.some((allowedDomain) => ["*", "any"].includes(allowedDomain.toLowerCase()))) {
    return true;
  }

  return allowedDomains.some((allowedDomain) => {
    const normalizedDomain = allowedDomain.toLowerCase();
    return domain === normalizedDomain || domain.endsWith(`.${normalizedDomain}`);
  });
}

export function getOAuthProviderConfig(provider: OAuthProviderId): OAuthProviderConfig {
  if (provider === "google") {
    return {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId: readFirstEnv("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"),
      clientSecret: readFirstEnv("GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
      extraAuthorizationParams: {
        access_type: "online",
        include_granted_scopes: "true",
        prompt: "select_account",
      },
      id: provider,
      label: "Google",
      scopes: ["openid", "email", "profile"],
      tokenUrl: "https://oauth2.googleapis.com/token",
    };
  }

  if (provider === "github") {
    return {
      authorizationUrl: "https://github.com/login/oauth/authorize",
      clientId: readFirstEnv("GITHUB_OAUTH_CLIENT_ID", "GITHUB_CLIENT_ID"),
      clientSecret: readFirstEnv("GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"),
      extraAuthorizationParams: {
        allow_signup: "true",
      },
      id: provider,
      label: "GitHub",
      scopes: ["read:user", "user:email"],
      tokenUrl: "https://github.com/login/oauth/access_token",
    };
  }

  const tenantId = encodeURIComponent(
    String(process.env.MICROSOFT_TENANT_ID || "organizations").trim() || "organizations",
  );

  return {
    authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    clientId: readFirstEnv("MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_CLIENT_ID"),
    clientSecret: readFirstEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET"),
    extraAuthorizationParams: {
      prompt: "select_account",
    },
    id: provider,
    label: "Microsoft",
    scopes: ["openid", "profile", "email", "User.Read"],
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  };
}

export function isOAuthProviderConfigured(config: OAuthProviderConfig) {
  return Boolean(config.clientId && config.clientSecret);
}

export function resolveRequestOrigin(req: any) {
  const forwardedProto = firstForwardedHeader(req.headers?.["x-forwarded-proto"]);
  const forwardedHost = firstForwardedHeader(req.headers?.["x-forwarded-host"]);
  const proto = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get?.("host") || req.headers?.host || `127.0.0.1:${process.env.PORT || 4000}`;
  return `${proto}://${host}`;
}

export function buildOAuthCallbackUrl(req: any, provider: OAuthProviderId) {
  const publicBaseUrl =
    readFirstEnv(
      `${provider.toUpperCase()}_OAUTH_PUBLIC_BASE_URL`,
      `${provider.toUpperCase()}_AUTH_PUBLIC_BASE_URL`,
      "OAUTH_PUBLIC_BASE_URL",
      "AUTH_PUBLIC_BASE_URL",
    ) || resolveRequestOrigin(req);
  return new URL(`/api/auth/oauth/${provider}/callback`, withTrailingSlash(publicBaseUrl)).toString();
}

function buildClientHashUrl(req: any, hashPath: string, params: Record<string, string>) {
  const clientBaseUrl =
    readFirstEnv("OAUTH_CLIENT_REDIRECT_URL", "CLIENT_PUBLIC_URL", "PUBLIC_APP_URL", "APP_PUBLIC_URL") ||
    resolveRequestOrigin(req);
  const url = new URL(clientBaseUrl);
  url.hash = `/${hashPath.replace(/^\/+/, "")}?${new URLSearchParams(params).toString()}`;
  return url.toString();
}

export function buildClientAuthRedirectUrl(req: any, params: Record<string, string>) {
  return buildClientHashUrl(req, "auth/callback", params);
}

export function buildClientPasswordResetUrl(req: any, token: string) {
  return buildClientHashUrl(req, "reset-password", { token });
}

export function buildClientEmailVerificationUrl(req: any, token: string) {
  return buildClientHashUrl(req, "verify-email", { token });
}

export function signOAuthState(provider: OAuthProviderId, secret: string) {
  return jwt.sign(
    {
      kind: "oauth",
      nonce: crypto.randomBytes(16).toString("base64url"),
      provider,
    },
    secret,
    { expiresIn: "10m" },
  );
}

export function verifyOAuthState(state: string, expectedProvider: OAuthProviderId, secret: string) {
  const payload = jwt.verify(state, secret) as { kind?: string; provider?: string };
  return payload.kind === "oauth" && payload.provider === expectedProvider;
}

export function buildOAuthAuthorizationUrl(config: OAuthProviderConfig, redirectUri: string, state: string) {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);

  for (const [key, value] of Object.entries(config.extraAuthorizationParams || {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

async function fetchJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      payload?.error_description ||
      payload?.message ||
      payload?.error ||
      `OAuth provider request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

export async function exchangeOAuthCode(config: OAuthProviderConfig, code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  return fetchJson(config.tokenUrl, {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const profile = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const email = normalizeEmail(profile.email);

  if (!email || profile.email_verified === false) {
    throw new Error("Google did not return a verified email address.");
  }

  return {
    email,
    name: String(profile.name || email.split("@")[0]).trim(),
    provider: "google",
    providerUserId: String(profile.sub || ""),
  };
}

async function fetchGitHubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [profile, emails] = await Promise.all([
    fetchJson("https://api.github.com/user", { headers }),
    fetchJson("https://api.github.com/user/emails", { headers }),
  ]);
  const verifiedEmail =
    Array.isArray(emails) &&
    (emails.find((item) => item?.primary && item?.verified) || emails.find((item) => item?.verified));
  const email = normalizeEmail(verifiedEmail?.email);

  if (!email) {
    throw new Error("GitHub did not return a verified email address.");
  }

  return {
    email,
    name: String(profile.name || profile.login || email.split("@")[0]).trim(),
    provider: "github",
    providerUserId: String(profile.id || ""),
  };
}

async function fetchMicrosoftProfile(accessToken: string): Promise<OAuthProfile> {
  const profile = await fetchJson("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const email = normalizeEmail(profile.mail || profile.userPrincipalName);

  if (!email || !isEmailAllowedForMicrosoft(email)) {
    throw new Error("Microsoft sign-in is limited to NUS school or organization email accounts.");
  }

  return {
    email,
    name: String(profile.displayName || email.split("@")[0]).trim(),
    provider: "microsoft",
    providerUserId: String(profile.id || ""),
  };
}

export async function fetchOAuthProfile(provider: OAuthProviderId, tokenPayload: any): Promise<OAuthProfile> {
  const accessToken = String(tokenPayload?.access_token || "");
  if (!accessToken) {
    throw new Error("OAuth provider did not return an access token.");
  }

  if (provider === "google") return fetchGoogleProfile(accessToken);
  if (provider === "github") return fetchGitHubProfile(accessToken);
  return fetchMicrosoftProfile(accessToken);
}
