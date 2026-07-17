import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import multer from "multer";
import nodemailer from "nodemailer";
import { Server } from "socket.io";
import {
  BUILT_IN_LLM_PROVIDER_ID,
  LLM_KEY_LIMIT_PER_USER,
  buildBuddyProviderOptions,
  buddyProviderMeta,
  canEncryptLlmApiKeys,
  encryptLlmApiKey,
  getLlmProvider,
  hashLlmApiKeySecret,
  normalizeLlmApiSecret,
  normalizeLlmLabel,
  normalizeLlmModel,
  normalizeLlmProviderCatalog,
  normalizeStoredLlmApiKeys,
  previewLlmApiKey,
  publicLlmApiKeysDto,
  resolveBuddyProviderSelection,
} from "./llmProviders.js";
import {
  buildClientAuthRedirectUrl,
  buildClientEmailVerificationUrl,
  buildClientPasswordResetUrl,
  buildOAuthAuthorizationUrl,
  buildOAuthCallbackUrl,
  exchangeOAuthCode,
  fetchOAuthProfile,
  getOAuthProviderConfig,
  isOAuthProviderConfigured,
  normalizeOAuthProvider,
  signOAuthState,
  verifyOAuthState,
} from "./oauth.js";
import {
  deleteUploadBlob,
  hasDatabaseUploadBlobStore,
  initDb,
  readDb,
  readUploadBlob,
  saveUploadBlob,
  storageMode,
  writeDb,
} from "./store.js";

const execFileAsync = promisify(execFile);

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }

    interface Response {
      flush?: () => void;
    }
  }
}

declare module "socket.io" {
  interface Socket {
    user?: any;
  }
}

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const serverRootDir = path.basename(runtimeDir) === "dist" ? path.dirname(runtimeDir) : runtimeDir;
const uploadDir = path.join(serverRootDir, "uploads");
const clientDistDir = path.join(serverRootDir, "..", "client", "dist");
const port = Number(process.env.PORT || 4000);
const jwtSecret =
  process.env.JWT_SECRET || "diffriendtiate-local-development-secret";
function resolveChatbotBaseUrl() {
  const explicitBaseUrl = String(process.env.CHATBOT_BASE_URL || "").trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");

  const host = String(process.env.CHATBOT_HOST || "").trim();
  if (host) {
    const portValue = String(process.env.CHATBOT_PORT || "").trim();
    const portSuffix = portValue ? `:${portValue}` : "";
    return `http://${host}${portSuffix}`;
  }

  return "http://127.0.0.1:5000";
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

const chatbotBaseUrl = resolveChatbotBaseUrl();
const chatbotWarmupBaseUrl = String(
  process.env.CHATBOT_WARMUP_BASE_URL ||
    process.env.CHATBOT_PUBLIC_URL ||
    chatbotBaseUrl,
)
  .trim()
  .replace(/\/+$/, "");
const chatbotDocumentExtensions = new Set([".pdf", ".txt", ".docx", ".pptx"]);
const chatbotHealthTimeoutMs = readPositiveNumber(
  process.env.CHATBOT_HEALTH_TIMEOUT_MS,
  90_000,
);
const chatbotWarmupTimeoutMs = readPositiveNumber(
  process.env.CHATBOT_WARMUP_TIMEOUT_MS,
  chatbotHealthTimeoutMs,
);
const chatbotWarmupAttempts = Math.max(
  1,
  Math.floor(readPositiveNumber(process.env.CHATBOT_WARMUP_ATTEMPTS, 2)),
);
const chatbotWarmupRetryDelayMs = readPositiveNumber(
  process.env.CHATBOT_WARMUP_RETRY_DELAY_MS,
  10_000,
);
const roomCorpusSyncCache = new Map();
const intelligrateGpuEnabled =
  String(process.env.INTELLIGRATE_GPU_ENABLED || process.env.GPU_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const builtInOllamaModel = String(process.env.LLM_MODEL || "qwen2.5:7b").trim() || "qwen2.5:7b";
const builtInGeminiModel = String(process.env.GEMINI_MODEL || "gemini-3.1-flash-lite").trim() || "gemini-3.1-flash-lite";
const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
const geminiApiKeyConfigured = Boolean(
  geminiApiKey &&
    !["your-key-here", "ci-placeholder", "qa-compose-validation-placeholder"].includes(geminiApiKey),
);
const builtInLlmDailyRequestLimit = readNonNegativeInteger(
  process.env.BUILT_IN_LLM_DAILY_REQUEST_LIMIT,
  0,
);
const builtInLlmQuotaCooldownMs =
  readPositiveNumber(process.env.BUILT_IN_LLM_QUOTA_COOLDOWN_MINUTES, 60) * 60 * 1000;
let builtInLlmQuotaCooldownUntilMs = 0;
let builtInLlmQuotaCooldownReason = "";

fs.mkdirSync(uploadDir, { recursive: true });

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createInviteCode() {
  return crypto.randomBytes(6).toString("base64url");
}

function toEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = toEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function authProviderKeys(user) {
  return Object.keys(user?.authProviders || {}).filter((provider) => provider !== "password");
}

function hasConfiguredPassword(user) {
  if (!user?.passwordHash) return false;
  if (user.authProviders?.password?.enabled === true) return true;
  return authProviderKeys(user).length === 0;
}

function markPasswordConfigured(user) {
  user.authProviders = {
    ...(user.authProviders || {}),
    password: {
      enabled: true,
      setAt: new Date().toISOString(),
    },
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified !== false,
    authProviders: authProviderKeys(user),
    hasPassword: hasConfiguredPassword(user),
    avatarPreset: user.avatarPreset || null,
    avatarUrl: user.avatarUrl || "",
  };
}

function normalizeAvatarUrl(value) {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl) return "";
  if (avatarUrl.length > 2_100_000) {
    const error = new Error("Profile picture is too large.") as Error & { status?: number };
    error.status = 413;
    throw error;
  }

  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(avatarUrl)) {
    const error = new Error("Profile picture must be a PNG, JPG, WebP, or GIF image.") as Error & {
      status?: number;
    };
    error.status = 400;
    throw error;
  }

  return avatarUrl;
}

function normalizeAvatarPreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = String(value.id || "").trim().slice(0, 80);
  const label = String(value.label || "Avatar").trim().slice(0, 80);
  const category = ["base", "clothing", "accessories", "special"].includes(value.category)
    ? value.category
    : "base";
  const layers = (Array.isArray(value.layers) ? value.layers : [])
    .map((layer) => {
      if (!layer || typeof layer !== "object" || Array.isArray(layer)) return null;
      const src = String(layer.src || "").trim();
      if (!src.startsWith("/assets/limeets/avatars/gather/")) return null;
      return {
        backSrc: String(layer.backSrc || "").startsWith("/assets/limeets/avatars/gather/")
          ? String(layer.backSrc || "").trim().slice(0, 500)
          : "",
        label: String(layer.label || "Layer").trim().slice(0, 80),
        slot: String(layer.slot || "layer").trim().slice(0, 40),
        src: src.slice(0, 500),
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  if (!id || !layers.length) return null;

  const selections =
    value.selections && typeof value.selections === "object" && !Array.isArray(value.selections)
      ? Object.fromEntries(
          Object.entries(value.selections)
            .map(([slotId, selection]) => {
              if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
                return [String(slotId).slice(0, 40), null];
              }
              return [
                String(slotId).slice(0, 40),
                {
                  itemId: String(selection.itemId || "").slice(0, 120),
                  variantId: String(selection.variantId || "").slice(0, 80),
                },
              ];
            })
            .filter(([slotId]) => Boolean(slotId))
            .slice(0, 16),
        )
      : {};

  return { id, label, category, layers, selections, version: 1 };
}

function currentAppDateKey() {
  return localDateKey(new Date(), APP_TIMEZONE) || new Date().toISOString().slice(0, 10);
}

function builtInLlmUsageSnapshot(user) {
  const day = currentAppDateKey();
  const usage = user?.builtInLlmUsage && typeof user.builtInLlmUsage === "object"
    ? user.builtInLlmUsage
    : {};
  const count =
    usage.day === day && Number.isFinite(Number(usage.count))
      ? Math.max(0, Math.floor(Number(usage.count)))
      : 0;
  const remaining =
    builtInLlmDailyRequestLimit > 0
      ? Math.max(0, builtInLlmDailyRequestLimit - count)
      : null;

  return {
    day,
    count,
    limit: builtInLlmDailyRequestLimit,
    remaining,
  };
}

function builtInLlmQuotaMessage() {
  return "The shared built-in Intelligrate quota is temporarily exhausted. Use a saved BYOK model or try again later.";
}

function getBuiltInLlmRestriction(user) {
  const now = Date.now();
  const usage = builtInLlmUsageSnapshot(user);

  if (builtInLlmQuotaCooldownUntilMs > now) {
    return {
      code: "quota_cooldown",
      message: builtInLlmQuotaMessage(),
      cooldownUntil: new Date(builtInLlmQuotaCooldownUntilMs).toISOString(),
      reason: builtInLlmQuotaCooldownReason,
      usage,
    };
  }

  if (builtInLlmDailyRequestLimit > 0 && usage.count >= builtInLlmDailyRequestLimit) {
    return {
      code: "daily_limit_reached",
      message: `You've reached today's built-in Intelligrate limit (${builtInLlmDailyRequestLimit} requests). Use a saved BYOK model or try again tomorrow.`,
      cooldownUntil: "",
      reason: "",
      usage,
    };
  }

  return null;
}

function getBuddyProviderStatus(user = null) {
  if (intelligrateGpuEnabled) {
    return {
      available: true,
      code: "local_gpu",
      provider: "ollama",
      providerLabel: "Ollama",
      model: builtInOllamaModel,
      message: "Intelligrate is using the app's built-in local model.",
    };
  }

  if (geminiApiKeyConfigured) {
    const restriction = getBuiltInLlmRestriction(user);
    const usage = builtInLlmUsageSnapshot(user);
    return {
      available: !restriction,
      code: restriction?.code || "gemini_configured",
      provider: "gemini",
      providerLabel: "Gemini",
      model: builtInGeminiModel,
      message: restriction?.message || "Intelligrate is using the configured Gemini API key.",
      cooldownUntil: restriction?.cooldownUntil || "",
      usage,
    };
  }

  return {
    available: false,
    code: "provider_required",
    provider: "none",
    providerLabel: "No LLM provider configured",
    model: "",
    message:
      "Intelligrate needs GPU mode or a configured Gemini API key before it can be used.",
  };
}

function buddyProviderHttpStatus(status) {
  return ["daily_limit_reached", "quota_cooldown"].includes(status?.code) ? 429 : 503;
}

function assertBuddyProviderAvailable(res, user = null) {
  const status = getBuddyProviderStatus(user);
  if (status.available) return status;

  res.status(buddyProviderHttpStatus(status)).json({
    ...status,
    setupRequired: true,
  });
  return null;
}

function isBuiltInLlmQuotaSignal(error) {
  if (error?.code === "daily_limit_reached") return false;
  const text = `${error?.status || ""} ${error?.message || error || ""}`.toLowerCase();
  return (
    error?.status === 429 ||
    /resource[\s_-]*exhausted|quota|rate[\s_-]*limit|too many requests/.test(text)
  );
}

function startBuiltInLlmQuotaCooldown(reason = "") {
  builtInLlmQuotaCooldownUntilMs = Date.now() + builtInLlmQuotaCooldownMs;
  builtInLlmQuotaCooldownReason = String(reason || "").slice(0, 300);
  return getBuddyProviderStatus();
}

async function reserveBuiltInLlmRequest(db, user) {
  const providerStatus = getBuddyProviderStatus(user);
  if (!providerStatus.available) {
    const error = createHttpError(buddyProviderHttpStatus(providerStatus), providerStatus.message) as Error & {
      code?: string;
    };
    error.code = providerStatus.code;
    throw error;
  }

  if (providerStatus.provider !== "gemini" || builtInLlmDailyRequestLimit <= 0 || !user) {
    return providerStatus;
  }

  const usage = builtInLlmUsageSnapshot(user);
  user.builtInLlmUsage = {
    ...user.builtInLlmUsage,
    day: usage.day,
    count: usage.count + 1,
  };
  await writeDb(db);
  return getBuddyProviderStatus(user);
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });
}

const passwordResetTokenTtlMs = 30 * 60 * 1000;
const emailVerificationTokenTtlMs = 24 * 60 * 60 * 1000;
const emailVerificationResendCooldownMs = 60 * 1000;
function readBooleanEnv(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

const exposeAuthActionLinks =
  process.env.NODE_ENV !== "production" &&
  (readBooleanEnv("AUTH_DEV_ACTION_LINKS") ||
    readBooleanEnv("AUTH_DEV_RESET_LINKS") ||
    readBooleanEnv("AUTH_TEST_ACTION_LINKS"));

function createAuthActionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashAuthActionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function readEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function isMailConfigured() {
  return Boolean(readEnv("SMTP_URL") || (readEnv("SMTP_HOST") && readEnv("AUTH_EMAIL_FROM", "SMTP_FROM")));
}

function authMailboxUrl() {
  return readEnv("AUTH_MAILBOX_URL", "MAILPIT_WEB_URL");
}

function canDeliverAuthActionLinks() {
  return isMailConfigured() || exposeAuthActionLinks;
}

function assertAuthActionDeliveryConfigured(res) {
  if (canDeliverAuthActionLinks()) return true;

  res.status(503).json({
    message: "Email delivery is not configured yet.",
  });
  return false;
}

function createMailTransporter() {
  const smtpUrl = readEnv("SMTP_URL");
  if (smtpUrl) return nodemailer.createTransport(smtpUrl);

  const user = readEnv("SMTP_USER");
  const pass = readEnv("SMTP_PASS");
  const portValue = Number(readEnv("SMTP_PORT") || 587);
  return nodemailer.createTransport({
    host: readEnv("SMTP_HOST"),
    port: Number.isFinite(portValue) ? portValue : 587,
    secure: String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" || portValue === 465,
    auth: user || pass ? { user, pass } : undefined,
  });
}

async function sendAuthEmail({ html, subject, text, to }) {
  if (!isMailConfigured()) return { sent: false };

  const from = readEnv("AUTH_EMAIL_FROM", "SMTP_FROM");
  try {
    await createMailTransporter().sendMail({
      from,
      html,
      subject,
      text,
      to,
    });
  } catch (error) {
    console.warn(`[auth] Email delivery failed: ${(error as Error).message}`);
    const deliveryError = new Error("Email delivery failed. Check the SMTP configuration.") as Error & {
      status?: number;
    };
    deliveryError.status = 502;
    throw deliveryError;
  }
  return { sent: true };
}

function passwordResetInstructionsPayload(req, token = "", emailSent = false) {
  const payload: any = {
    message: emailSent
      ? "If an account exists, a password reset email has been sent."
      : "If an account exists, password reset instructions are available.",
    resetEmailSent: emailSent,
  };

  const mailboxUrl = authMailboxUrl();
  if (emailSent && mailboxUrl) {
    payload.mailboxUrl = mailboxUrl;
  }

  if (exposeAuthActionLinks && token) {
    payload.resetToken = token;
    payload.resetLink = buildClientPasswordResetUrl(req, token);
  }

  return payload;
}

function emailVerificationInstructionsPayload(req, token = "", emailSent = false) {
  const payload: any = {
    emailVerificationRequired: true,
    message: emailSent
      ? "Check your email to verify your account."
      : "Email verification instructions are available.",
    verificationEmailSent: emailSent,
  };

  const mailboxUrl = authMailboxUrl();
  if (emailSent && mailboxUrl) {
    payload.mailboxUrl = mailboxUrl;
  }

  if (exposeAuthActionLinks && token) {
    payload.verificationToken = token;
    payload.verificationLink = buildClientEmailVerificationUrl(req, token);
  }

  return payload;
}

function createEmailVerification(user) {
  const token = createAuthActionToken();
  const now = new Date();
  user.emailVerification = {
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + emailVerificationTokenTtlMs).toISOString(),
    tokenHash: hashAuthActionToken(token),
  };
  user.emailVerified = false;
  return token;
}

function emailVerificationRetryAfterSeconds(user) {
  const createdAt = Date.parse(String(user?.emailVerification?.createdAt || ""));
  if (!Number.isFinite(createdAt)) return 0;

  const remainingMs = emailVerificationResendCooldownMs - (Date.now() - createdAt);
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

function applyEmailVerificationRetryAfter(res, retryAfterSeconds) {
  res.set("Retry-After", String(retryAfterSeconds));
}

async function sendPasswordResetEmail(req, user, token) {
  const resetLink = buildClientPasswordResetUrl(req, token);
  return sendAuthEmail({
    to: user.email,
    subject: "Reset your Diffriendtiate password",
    text: `Reset your Diffriendtiate password here: ${resetLink}\n\nThis link expires in 30 minutes.`,
    html: `<p>Reset your Diffriendtiate password here:</p><p><a href="${resetLink}">Reset Password</a></p><p>This link expires in 30 minutes.</p>`,
  });
}

async function sendEmailVerificationEmail(req, user, token) {
  const verificationLink = buildClientEmailVerificationUrl(req, token);
  return sendAuthEmail({
    to: user.email,
    subject: "Verify your Diffriendtiate email",
    text: `Verify your Diffriendtiate email here: ${verificationLink}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your Diffriendtiate email here:</p><p><a href="${verificationLink}">Verify Email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

function getSupabaseAuthConfig() {
  return {
    anonKey: readEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"),
    url: readEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/+$/, ""),
  };
}

function isSupabaseAuthConfigured() {
  const config = getSupabaseAuthConfig();
  return Boolean(config.url && config.anonKey);
}

async function fetchSupabaseAuthUser(accessToken) {
  const config = getSupabaseAuthConfig();
  if (!config.url || !config.anonKey || !accessToken) return null;

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) return null;
  return response.json();
}

async function deleteSupabaseAuthUser(user) {
  const config = getSupabaseAuthConfig();
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUserId = String(user?.authProviders?.supabase?.id || "").trim();
  if (!supabaseUserId) return;

  if (!config.url || !serviceRoleKey) {
    const deletionError = new Error(
      "Supabase account deletion is not configured. Set SUPABASE_SERVICE_ROLE_KEY before deleting Supabase-backed accounts.",
    ) as Error & {
      status?: number;
    };
    deletionError.status = 503;
    throw deletionError;
  }

  const response = await fetch(
    `${config.url}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const deletionError = new Error("Supabase account deletion failed.") as Error & {
      status?: number;
    };
    deletionError.status = 502;
    throw deletionError;
  }
}

function supabaseUserDisplayName(supabaseUser, fallbackName = "") {
  const metadata =
    supabaseUser?.user_metadata && typeof supabaseUser.user_metadata === "object"
      ? supabaseUser.user_metadata
      : {};
  return String(
    fallbackName ||
      metadata.name ||
      metadata.full_name ||
      metadata.preferred_username ||
      supabaseUser?.email?.split("@")?.[0] ||
      "Diffriendtiate User",
  )
    .trim()
    .slice(0, 80);
}

async function upsertSupabaseUser(db, supabaseUser, fallbackName = "") {
  const supabaseId = String(supabaseUser?.id || "").trim();
  const email = toEmail(supabaseUser?.email);
  if (!supabaseId || !email) {
    throw new Error("Supabase session did not include a verified user identity.");
  }

  const existingUser = db.users.find(
    (candidate) =>
      candidate?.authProviders?.supabase?.id === supabaseId ||
      toEmail(candidate.email) === email,
  );
  const providerLink = {
    email,
    id: supabaseId,
    linkedAt: new Date().toISOString(),
  };
  const emailVerified = Boolean(
    supabaseUser.email_confirmed_at ||
      supabaseUser.confirmed_at ||
      supabaseUser.email_verified,
  );

  if (existingUser) {
    let changed = false;
    if (hasConfiguredPassword(existingUser) && existingUser.authProviders?.password?.enabled !== true) {
      markPasswordConfigured(existingUser);
      changed = true;
    }
    if (existingUser.email !== email) {
      existingUser.email = email;
      changed = true;
    }
    if (!existingUser.authProviders?.supabase || existingUser.authProviders.supabase.id !== supabaseId) {
      existingUser.authProviders = {
        ...(existingUser.authProviders || {}),
        supabase: providerLink,
      };
      changed = true;
    }
    if (!existingUser.passwordHash) {
      existingUser.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
      changed = true;
    }
    if (!String(existingUser.name || "").trim()) {
      existingUser.name = supabaseUserDisplayName(supabaseUser, fallbackName);
      changed = true;
    }
    if (emailVerified && existingUser.emailVerified === false) {
      existingUser.emailVerified = true;
      existingUser.emailVerification = null;
      changed = true;
    }
    return { changed, user: existingUser };
  }

  const now = new Date().toISOString();
  const user = {
    id: createId("usr"),
    name: supabaseUserDisplayName(supabaseUser, fallbackName),
    email,
    avatarPreset: null,
    avatarUrl: "",
    authProviders: {
      supabase: providerLink,
    },
    emailVerified,
    emailVerification: null,
    passwordReset: null,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10),
    createdAt: now,
  };

  db.users.push(user);
  return { changed: true, user };
}

async function getUserBySupabaseAccessToken(accessToken, fallbackName = "") {
  if (!isSupabaseAuthConfigured()) return null;

  const supabaseUser = await fetchSupabaseAuthUser(accessToken);
  if (!supabaseUser) return null;

  const db = await readDb();
  const result = await upsertSupabaseUser(db, supabaseUser, fallbackName);
  if (result.changed) {
    await writeDb(db);
  }
  return result.user;
}

async function upsertOAuthUser(db, profile) {
  const existingUser = db.users.find((candidate) => candidate.email === profile.email);
  const linkedAt = new Date().toISOString();
  const providerLink = {
    email: profile.email,
    id: profile.providerUserId || profile.email,
    linkedAt,
  };

  if (existingUser) {
    if (hasConfiguredPassword(existingUser) && existingUser.authProviders?.password?.enabled !== true) {
      markPasswordConfigured(existingUser);
    }
    existingUser.authProviders = {
      ...(existingUser.authProviders || {}),
      [profile.provider]: providerLink,
    };
    if (!existingUser.passwordHash) {
      existingUser.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
    }
    if (!String(existingUser.name || "").trim()) {
      existingUser.name = profile.name.slice(0, 80) || profile.email.split("@")[0];
    }
    existingUser.emailVerified = true;
    existingUser.emailVerification = null;
    return existingUser;
  }

  const now = new Date().toISOString();
  const user = {
    id: createId("usr"),
    name: profile.name.slice(0, 80) || profile.email.split("@")[0],
    email: profile.email,
    avatarPreset: null,
    avatarUrl: "",
    authProviders: {
      [profile.provider]: providerLink,
    },
    emailVerified: true,
    emailVerification: null,
    passwordReset: null,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10),
    createdAt: now,
  };

  db.users.push(user);
  return user;
}

/**
 * Resolves a bearer token into the latest user record.
 * Reading the database each time means deleted users lose access immediately.
 */
async function getUserByToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, jwtSecret);
    const db = await readDb();
    const localUser = db.users.find((user) => user.id === payload.sub) || null;
    if (localUser) return localUser;
  } catch {
    // Supabase access tokens are signed outside this app, so they fall through
    // to Supabase Auth verification below.
  }

  return getUserBySupabaseAccessToken(token);
}

/**
 * Express guard for authenticated routes.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = await getUserByToken(token);

  if (!user) {
    return res.status(401).json({ message: "Please log in again." });
  }

  req.user = user;
  next();
}

function isMember(room, userId) {
  return (
    room?.ownerId === userId ||
    (Array.isArray(room?.memberIds) && room.memberIds.includes(userId))
  );
}

const DEFAULT_SPACE_POSITION = { x: 50, y: 62 };
const SPACE_MIN_POSITION = 5;
const SPACE_MAX_POSITION = 16384;
const DEFAULT_SPACE_TILE = { mapId: "office-main", col: 18, row: 44 };
const SPACE_MIN_TILE = 0;
const SPACE_MAX_TILE_COL = 255;
const SPACE_MAX_TILE_ROW = 255;
const SPACE_MAP_IDS = new Set(["office-main", "office-socials", "custom-world"]);
const SPACE_DIRECTIONS = new Set(["down", "left", "right", "up"]);
const ROOM_ACTIVITY_TABS = new Set([
  "focus",
  "chat",
  "buddy",
  "resources",
  "space",
  "meetings",
  "calendar",
]);
const PROFILE_STATUSES = new Set(["online", "away", "dnd", "invisible"]);
const WORLD_NAVIGATION_TABS = new Set(["focus", "chat", "buddy", "resources", "space", "calendar"]);
const WORLD_CONFIG_DEFAULT = {
  enabled: true,
  version: 2,
  backgroundImage: "",
  tileSize: 32,
  columns: 64,
  rows: 40,
  activeRoomId: "custom-world",
  spawnpoint: { roomId: "custom-world", x: 32, y: 20 },
  spawn: { mapId: "custom-world", col: 6, row: 6 },
  rooms: [{ id: "custom-world", name: "World", tilemap: {} }],
  collisions: [],
  objects: [],
  privateAreas: [],
  zones: [],
};
const WORLD_CONFIG_MAX_BACKGROUND_LENGTH = 3_500_000;
const WORLD_CONFIG_MAX_COLLISIONS = 8_000;
const WORLD_CONFIG_MAX_OBJECTS = 500;
const WORLD_CONFIG_MAX_ZONES = 48;
const WORLD_CONFIG_MAX_ROOMS = 24;
const WORLD_CONFIG_MAX_TILES = 14_000;
// Temporary live presence only: Limeets avatar positions and meeting sessions
// are intentionally kept in memory, not durable room knowledge.
const spacePresenceByRoom = new Map();
const roomActivityByRoom = new Map();
const meetingPresenceByRoom = new Map();

function normalizeSpacePosition(value, fallback = null) {
  if (!value || typeof value !== "object") return fallback;

  const col = Number(value?.col);
  const row = Number(value?.row);
  const x = Number(value?.x);
  const y = Number(value?.y);
  const fallbackMapId = fallback?.mapId || DEFAULT_SPACE_TILE.mapId;
  const requestedMapId = typeof value?.mapId === "string" ? value.mapId.trim() : fallbackMapId;
  const mapId = SPACE_MAP_IDS.has(requestedMapId) ? requestedMapId : fallbackMapId;
  const worldRoomId = String(value?.worldRoomId || fallback?.worldRoomId || "custom-world")
    .trim()
    .slice(0, 64) || "custom-world";
  const direction = SPACE_DIRECTIONS.has(String(value?.direction || ""))
    ? String(value.direction)
    : fallback?.direction || "down";
  const moving = Boolean(value?.moving);

  if (Number.isFinite(col) && Number.isFinite(row)) {
    const position = {
      mapId,
      worldRoomId,
      col: Math.min(SPACE_MAX_TILE_COL, Math.max(SPACE_MIN_TILE, Math.round(col))),
      row: Math.min(SPACE_MAX_TILE_ROW, Math.max(SPACE_MIN_TILE, Math.round(row))),
      direction,
      moving,
    };

    if (Number.isFinite(x) && Number.isFinite(y)) {
      position.x = Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, x));
      position.y = Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, y));
    }

    return position;
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;

  return {
    x: Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, x)),
    y: Math.min(SPACE_MAX_POSITION, Math.max(SPACE_MIN_POSITION, y)),
    worldRoomId,
    direction,
    moving,
  };
}

function normalizeRoomActivityTab(value) {
  const tabId = String(value || "").trim();
  return ROOM_ACTIVITY_TABS.has(tabId) ? tabId : null;
}

function normalizeProfileStatus(value) {
  const status = String(value || "").trim();
  return PROFILE_STATUSES.has(status) ? status : "online";
}

function normalizeDocumentPage(value, fallback = null) {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return fallback;
  return Math.floor(page);
}

function getSpaceRoomKey(roomId) {
  // Keep live avatar broadcasts separate from the room chat Socket.IO room.
  return `space:${roomId}`;
}

function normalizeMeetingAreaId(value) {
  const areaId = String(value || "").trim().slice(0, 72);
  return areaId || null;
}

function getMeetingRoomKey(roomId, areaId) {
  return `meeting:${roomId}:${areaId}`;
}

function getMeetingRoomPresence(roomId) {
  if (!meetingPresenceByRoom.has(roomId)) {
    meetingPresenceByRoom.set(roomId, new Map());
  }

  return meetingPresenceByRoom.get(roomId);
}

function getMeetingAreaPresence(roomId, areaId) {
  const roomPresence = getMeetingRoomPresence(roomId);
  if (!roomPresence.has(areaId)) {
    roomPresence.set(areaId, new Map());
  }

  return roomPresence.get(areaId);
}

function serializeMeetingPresence(roomId, areaId) {
  return Array.from(meetingPresenceByRoom.get(roomId)?.get(areaId)?.values() || [])
    .filter((presence) => presence.profileStatus !== "invisible")
    .map(({ socketId: _socketId, ...presence }) => presence);
}

function serializeMeetingSummary(roomId) {
  return Array.from(meetingPresenceByRoom.get(roomId)?.entries() || [])
    .map(([areaId]) => ({
      roomId,
      areaId,
      users: serializeMeetingPresence(roomId, areaId),
    }))
    .filter((summary) => summary.users.length);
}

function normalizeMeetingMedia(value) {
  const media = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    cameraOff: Boolean(media.cameraOff),
    deafened: Boolean(media.deafened),
    muted: Boolean(media.muted),
    screenSharing: Boolean(media.screenSharing),
  };
}

function normalizeMeetingSignal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const type = String(value.type || "").trim();
  if (type === "offer" || type === "answer") {
    const sdp = String(value.sdp || "");
    if (!sdp || sdp.length > 200_000) return null;
    return { type, sdp };
  }

  if (type === "ice") {
    const rawCandidate =
      value.candidate && typeof value.candidate === "object" && !Array.isArray(value.candidate)
        ? value.candidate
        : {};
    const candidate = String(rawCandidate.candidate || "").slice(0, 5_000);
    if (!candidate) return null;

    return {
      type,
      candidate: {
        candidate,
        sdpMid:
          rawCandidate.sdpMid === null || rawCandidate.sdpMid === undefined
            ? null
            : String(rawCandidate.sdpMid).slice(0, 64),
        sdpMLineIndex: Number.isFinite(Number(rawCandidate.sdpMLineIndex))
          ? Number(rawCandidate.sdpMLineIndex)
          : null,
      },
    };
  }

  return null;
}

function getSpacePresence(roomId) {
  if (!spacePresenceByRoom.has(roomId)) {
    spacePresenceByRoom.set(roomId, new Map());
  }

  return spacePresenceByRoom.get(roomId);
}

function serializeSpacePresence(roomId) {
  return Array.from(spacePresenceByRoom.get(roomId)?.values() || [])
    .filter((presence) => presence.profileStatus !== "invisible")
    .map(({ socketId: _socketId, ...presence }) => presence);
}

function getRoomActivity(roomId) {
  if (!roomActivityByRoom.has(roomId)) {
    roomActivityByRoom.set(roomId, new Map());
  }

  return roomActivityByRoom.get(roomId);
}

function findSocketRoomActivity(socket) {
  const userId = socket.user?.id;
  if (!userId) return null;

  for (const [roomId, roomActivity] of roomActivityByRoom.entries()) {
    const activity = roomActivity.get(userId);
    if (activity?.socketId === socket.id) {
      return { roomId, roomActivity, activity };
    }
  }

  return null;
}

function serializeRoomActivity(roomId) {
  return Array.from(roomActivityByRoom.get(roomId)?.values() || [])
    .filter((activity) => activity.profileStatus !== "invisible")
    .map(({ socketId: _socketId, ...activity }) => activity);
}

function emitRoomActivityState(roomId) {
  io.to(`room:${roomId}`).emit("room:activity:state", {
    roomId,
    members: serializeRoomActivity(roomId),
  });
}

function updateSocketSpaceProfileStatus(socket, roomId, profileStatus) {
  const roomPresence = spacePresenceByRoom.get(roomId);
  const presence = roomPresence?.get(socket.id);
  if (!presence || presence.socketId !== socket.id) return;

  roomPresence.set(socket.id, {
    ...presence,
    profileStatus,
    updatedAt: new Date().toISOString(),
  });
  io.to(getSpaceRoomKey(roomId)).emit("space:state", {
    roomId,
    users: serializeSpacePresence(roomId),
  });
}

function updateSocketMeetingProfileStatus(socket, roomId, profileStatus) {
  const roomPresence = meetingPresenceByRoom.get(roomId);
  if (!roomPresence) return;

  for (const [areaId, areaPresence] of roomPresence.entries()) {
    const presence = areaPresence.get(socket.user?.id);
    if (!presence || presence.socketId !== socket.id) continue;

    areaPresence.set(socket.user.id, {
      ...presence,
      profileStatus,
      updatedAt: new Date().toISOString(),
    });
    emitMeetingState(roomId, areaId);
    emitMeetingSummary(roomId);
  }
}

function emitMeetingState(roomId, areaId) {
  io.to(getMeetingRoomKey(roomId, areaId)).emit("meeting:state", {
    roomId,
    areaId,
    users: serializeMeetingPresence(roomId, areaId),
  });
}

function emitMeetingSummary(roomId, target = io.to(`room:${roomId}`)) {
  target.emit("meeting:summary", {
    roomId,
    areas: serializeMeetingSummary(roomId),
  });
}

function removeSocketSpacePresence(socket, targetRoomId = null) {
  for (const [roomId, roomPresence] of Array.from(spacePresenceByRoom.entries())) {
    if (targetRoomId && roomId !== targetRoomId) continue;

    const presence = roomPresence.get(socket.id);
    if (!presence || presence.socketId !== socket.id) continue;

    roomPresence.delete(socket.id);
    socket.leave(getSpaceRoomKey(roomId));

    if (roomPresence.size) {
      io.to(getSpaceRoomKey(roomId)).emit("space:user-left", {
        presenceId: presence.presenceId,
        roomId,
        userId: presence.userId,
      });
    } else {
      spacePresenceByRoom.delete(roomId);
    }
  }
}

function removeSocketRoomActivity(socket, targetRoomId = null) {
  const userId = socket.user?.id;
  if (!userId) return;

  for (const [roomId, roomActivity] of Array.from(roomActivityByRoom.entries())) {
    if (targetRoomId && roomId !== targetRoomId) continue;

    const activity = roomActivity.get(userId);
    if (!activity || activity.socketId !== socket.id) continue;

    roomActivity.delete(userId);

    if (roomActivity.size) {
      emitRoomActivityState(roomId);
    } else {
      roomActivityByRoom.delete(roomId);
      io.to(`room:${roomId}`).emit("room:activity:state", {
        roomId,
        members: [],
      });
    }
  }
}

function removeSocketMeetingPresence(socket, targetRoomId = null, targetAreaId = null) {
  const userId = socket.user?.id;
  if (!userId) return;

  for (const [roomId, roomPresence] of Array.from(meetingPresenceByRoom.entries())) {
    if (targetRoomId && roomId !== targetRoomId) continue;

    for (const [areaId, areaPresence] of Array.from(roomPresence.entries())) {
      if (targetAreaId && areaId !== targetAreaId) continue;

      const presence = areaPresence.get(userId);
      if (!presence || presence.socketId !== socket.id) continue;

      areaPresence.delete(userId);
      socket.leave(getMeetingRoomKey(roomId, areaId));

      if (areaPresence.size) {
        io.to(getMeetingRoomKey(roomId, areaId)).emit("meeting:user-left", {
          roomId,
          areaId,
          userId,
        });
        emitMeetingState(roomId, areaId);
      } else {
        roomPresence.delete(areaId);
      }

      emitMeetingSummary(roomId);
    }

    if (!roomPresence.size) {
      meetingPresenceByRoom.delete(roomId);
      emitMeetingSummary(roomId);
    }
  }
}

function canViewRoom(room, userId) {
  return isMember(room, userId);
}

function canDiscoverRoom(room, userId) {
  return room.visibility === "public" || isMember(room, userId);
}

/**
 * Converts a stored room into the client-facing shape, including derived
 * membership, owner, and latest-activity metadata.
 */
function roomDto(db, room, userId) {
  const owner = db.users.find((user) => user.id === room.ownerId);
  const messages = db.messages.filter((message) => message.roomId === room.id);
  const latestMessage = messages.at(-1);
  const members = (room.memberIds || [])
    .map((memberId) => publicUser(db.users.find((user) => user.id === memberId)))
    .filter(Boolean);

  return {
    id: room.id,
    name: room.name,
    moduleCode: room.moduleCode,
    academicTerm: room.academicTerm || "",
    roomLogo: room.roomLogo || "",
    description: room.description,
    visibility: room.visibility,
    tags: room.tags || [],
    theme: room.theme,
    background: room.background || "aurora",
    worldConfig: normalizeWorldConfig(room.worldConfig),
    integrations: publicRoomIntegrations(room),
    inviteCode: isMember(room, userId) ? room.inviteCode : null,
    channels: normalizeChannels(room.channels),
    channelLayout: normalizeRoomChannelLayout(room.channelLayout, room.channels),
    owner: publicUser(owner),
    members,
    isOwner: room.ownerId === userId,
    isMember: isMember(room, userId),
    memberCount: room.memberIds.length,
    messageCount: messages.length,
    latestMessageAt: latestMessage?.createdAt || room.createdAt,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

function messageDto(db, message) {
  return {
    ...message,
    channel: normalizeChannel(message.channel || "general"),
    attachments: normalizeMessageAttachments(message.attachments),
    sender: publicUser(db.users.find((user) => user.id === message.senderId)),
  };
}

function getEffectiveResourceType(resource) {
  const detectedResourceType = detectResourceType(
    resource?.mimeType,
    resource?.originalName || resource?.storageName || resource?.title,
  );
  return ["pdf", "docx", "pptx", "image"].includes(resource?.resourceType)
    ? resource.resourceType
    : detectedResourceType;
}

function resourceDto(db, resource) {
  const resourceType = getEffectiveResourceType(resource);
  const isOfficeResource = resourceType === "docx" || resourceType === "pptx";
  const hasCurrentOfficePdf =
    isOfficeResource &&
    Boolean(resource?.pdfPath) &&
    resource?.pdfConversionVersion === OFFICE_PDF_CONVERSION_VERSION;
  const storedConversionStatus = ["pending", "done", "failed", "not-needed"].includes(resource?.conversionStatus)
    ? resource.conversionStatus
    : "not-needed";
  const conversionStatus = hasCurrentOfficePdf
    ? "done"
    : isOfficeResource && storedConversionStatus === "done"
      ? "pending"
      : storedConversionStatus;
  const fileUrl = resource?.storageName ? uploadUrl(resource.storageName) : resource?.url || null;
  const pdfUrl = hasCurrentOfficePdf
    ? uploadUrl(resource.pdfPath)
    : resourceType === "pdf"
      ? fileUrl
      : null;

  return {
    ...resource,
    folder: resource.folder || "General",
    conversionStatus,
    deletedBy: publicUser(db.users.find((user) => user.id === resource.deletedById)),
    fileUrl,
    metadata: resource.metadata || {},
    pdfUrl,
    resourceType,
    updatedAt: resource.updatedAt || resource.createdAt,
    uploader: publicUser(db.users.find((user) => user.id === resource.uploaderId)),
  };
}

function publicRoomIntegrations(room) {
  const integrations = room.integrations && typeof room.integrations === "object" && !Array.isArray(room.integrations)
    ? room.integrations
    : {};
  const canvas = integrations.canvas && typeof integrations.canvas === "object" && !Array.isArray(integrations.canvas)
    ? integrations.canvas
    : null;

  return {
    ...integrations,
    canvas: canvas
      ? {
          connected: canvas.connected === true,
          host: canvas.host || "canvas.nus.edu.sg",
          courseId: canvas.courseId || "",
          courseName: canvas.courseName || "",
          courseCode: canvas.courseCode || "",
          connectedAt: canvas.connectedAt || "",
          lastSyncedAt: canvas.lastSyncedAt || "",
          importedDeadlineCount: Number(canvas.importedDeadlineCount) || 0,
          importedFileCount: Number(canvas.importedFileCount) || 0,
        }
      : null,
  };
}

function sessionDto(db, session) {
  return {
    ...session,
    creator: publicUser(db.users.find((user) => user.id === session.createdBy)),
  };
}

function coordinatePollDto(db, poll) {
  return {
    ...poll,
    creator: publicUser(db.users.find((user) => user.id === poll.createdBy)),
  };
}

function coordinateResponseDto(db, response) {
  return {
    ...response,
    user: publicUser(db.users.find((user) => user.id === response.userId)),
  };
}

function coordinateDto(db, room) {
  const polls = db.coordinatePolls
    .filter((poll) => poll.roomId === room.id)
    .sort((a, b) => String(a.rangeStart || a.createdAt).localeCompare(String(b.rangeStart || b.createdAt)));
  const activePoll =
    polls.find((poll) => !poll.scheduledSessionId) ||
    polls[polls.length - 1] ||
    null;

  return {
    poll: activePoll ? coordinatePollDto(db, activePoll) : null,
    polls: polls.map((poll) => coordinatePollDto(db, poll)),
    responses: db.coordinateResponses
      .filter((response) => response.roomId === room.id)
      .map((response) => coordinateResponseDto(db, response)),
  };
}

function normalizeBuddyVisibility(value) {
  return value === "public" ? "public" : "private";
}

function getBuddyThinkingText(value: any) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (typeof value === "object" && !Array.isArray(value)) {
    const directText =
      value.text ??
      value.message ??
      value.summary ??
      value.content ??
      value.output ??
      value.detail ??
      value.description ??
      "";

    return directText && directText !== value ? getBuddyThinkingText(directText) : "";
  }

  return "";
}

function normalizeBuddyThinkingStep(step: any) {
  if (step && typeof step === "object" && !Array.isArray(step)) {
    const text = getBuddyThinkingText(step)
      .trim()
      .slice(0, 1500);

    if (!text) return null;

      return {
        id: String(step.id || `${step.type || "thought"}:${text}`).slice(0, 260),
        type: ["tool", "done", "thought"].includes(step.type) ? step.type : "thought",
        text,
        summary: getBuddyThinkingText(step.summary).slice(0, 260),
        tool: String(step.tool || "").slice(0, 80),
        status: String(step.status || "").slice(0, 40),
        sourceType: String(step.sourceType || step.source_type || "").slice(0, 80),
      };
  }

  const text = String(step || "").trim().slice(0, 1500);
  if (!text) return null;

  return text;
}

function normalizeBuddyPdfRect(rect: any) {
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) return null;
  const x1 = Number(rect.x1);
  const y1 = Number(rect.y1);
  const x2 = Number(rect.x2);
  const y2 = Number(rect.y2);
  const width = Number(rect.width);
  const height = Number(rect.height);
  const pageNumber = Number(rect.pageNumber);

  if (![x1, y1, x2, y2, width, height, pageNumber].every(Number.isFinite)) return null;
  if (x2 <= x1 || y2 <= y1 || width <= 0 || height <= 0 || pageNumber < 1) return null;

  return {
    x1,
    y1,
    x2,
    y2,
    width,
    height,
    pageNumber: Math.floor(pageNumber),
  };
}

function normalizeBuddyPdfHighlightPosition(position: any) {
  if (!position || typeof position !== "object" || Array.isArray(position)) return undefined;

  const boundingRect = normalizeBuddyPdfRect(position.boundingRect || position.bounding_rect);
  const rects = (Array.isArray(position.rects) ? position.rects : [])
    .map(normalizeBuddyPdfRect)
    .filter(Boolean)
    .slice(0, 24);

  if (!boundingRect || !rects.length) return undefined;
  return { boundingRect, rects };
}

function normalizeBuddySourceRef(source: any) {
  if (typeof source === "string") {
    return source.trim().slice(0, 240);
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const type = String(source.type || source.sourceType || "").trim().slice(0, 80);
  const label = String(source.label || source.title || source.name || "").trim().slice(0, 180);
  if (!type || !label) return null;

  return {
    type,
    label,
    roomId: String(source.roomId || source.room_id || "").slice(0, 80),
    sourceId: String(source.sourceId || source.source_id || "").slice(0, 120),
    resourceId: String(source.resourceId || source.resource_id || "").slice(0, 120),
    messageId: String(source.messageId || source.message_id || "").slice(0, 120),
    annotationId: String(source.annotationId || source.annotation_id || "").slice(0, 120),
    sessionId: String(source.sessionId || source.session_id || "").slice(0, 120),
    pollId: String(source.pollId || source.poll_id || "").slice(0, 120),
    channel: String(source.channel || "").slice(0, 80),
    folder: String(source.folder || "").slice(0, 180),
    pageNumber: Number.isFinite(Number(source.pageNumber)) ? Number(source.pageNumber) : undefined,
    slideNumber: Number.isFinite(Number(source.slideNumber)) ? Number(source.slideNumber) : undefined,
    date: String(source.date || "").slice(0, 40),
    startsAt: String(source.startsAt || source.starts_at || "").slice(0, 80),
    textQuote: String(source.textQuote || source.text_quote || "").trim().slice(0, 600),
    highlightPosition: normalizeBuddyPdfHighlightPosition(source.highlightPosition || source.highlight_position),
    snippet: String(source.snippet || "").trim().slice(0, 600),
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : undefined,
  };
}

function buddySourceIdentity(source: any) {
  if (typeof source === "string") return source.trim().toLowerCase();
  if (!source || typeof source !== "object") return "";
  return [
    source.type,
    source.resourceId,
    source.messageId,
    source.annotationId,
    source.sessionId,
    source.pollId,
    source.sourceId,
    source.pageNumber,
    source.slideNumber,
  ].map((part) => String(part || "")).join("|");
}

function normalizeBuddySources(value: any) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(normalizeBuddySourceRef)
    .filter(Boolean)
    .filter((source) => {
      const key = buddySourceIdentity(source);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function normalizeBuddyThreadMessages(value: any, actor: any = null) {
  if (!Array.isArray(value)) return [];

  return value
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const body = String(message?.body || message?.content || "").trim().slice(0, 12000);
      const preface =
        role === "assistant"
          ? String(message?.preface || "").trim().slice(0, 3000)
          : "";
      const attachments = normalizeMessageAttachments(message?.attachments);
      const sources = normalizeBuddySources(message?.sources);
      const thinkingSteps =
        role === "assistant" && Array.isArray(message?.thinkingSteps)
          ? message.thinkingSteps
              .map(normalizeBuddyThinkingStep)
              .filter(Boolean)
              .slice(0, 40)
          : [];
      const providerName =
        role === "assistant"
          ? String(message?.providerName || message?.provider || "Intelligrate")
              .trim()
              .slice(0, 80) || "Intelligrate"
          : "";

      return {
        id: String(message?.id || createId("bmsg")),
        role,
        preface,
        body,
        attachments,
        sources,
        thinkingSteps,
        isThinking: false,
        providerKeyId:
          role === "assistant"
            ? String(message?.providerKeyId || BUILT_IN_LLM_PROVIDER_ID).slice(0, 80)
            : "",
        providerId:
          role === "assistant"
            ? String(message?.providerId || message?.provider || BUILT_IN_LLM_PROVIDER_ID).slice(0, 80)
            : "",
        providerName,
        providerLabel:
          role === "assistant"
            ? String(message?.providerLabel || message?.label || "").trim().slice(0, 80)
            : "",
        model:
          role === "assistant"
            ? String(message?.model || "").trim().slice(0, 180)
            : "",
        authorId: role === "user" ? String(message?.authorId || actor?.id || "") : null,
        authorName: role === "user" ? String(message?.authorName || actor?.name || "") : null,
        createdAt: message?.createdAt || new Date().toISOString(),
      };
    })
    .filter(
      (message) =>
        message.body ||
        message.preface ||
        message.attachments.length ||
        message.sources.length ||
        message.thinkingSteps.length,
    )
    .slice(-80);
}

function canViewBuddyThread(thread, userId) {
  return thread.visibility === "public" || thread.ownerId === userId;
}

function canEditBuddyThread(thread, userId) {
  return thread.ownerId === userId;
}

function isSubstantiveBuddyThread(thread) {
  return normalizeBuddyThreadMessages(thread.messages).length > 0;
}

function buddyThreadDto(db, thread, userId) {
  return {
    ...thread,
    visibility: normalizeBuddyVisibility(thread.visibility),
    messages: normalizeBuddyThreadMessages(thread.messages),
    owner: publicUser(db.users.find((user) => user.id === thread.ownerId)),
    isOwner: thread.ownerId === userId,
  };
}

function normalizeTags(value) {
  // Room cards are designed around at most three visible tags.
  if (Array.isArray(value)) {
    return value.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeWorldImage(value) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (!image.startsWith("data:image/")) return "";
  if (image.length > WORLD_CONFIG_MAX_BACKGROUND_LENGTH) return "";
  return image;
}

function normalizeWorldTile(value, columns, rows, fallback) {
  const fallbackTile = fallback || WORLD_CONFIG_DEFAULT.spawn;
  return {
    mapId: "custom-world",
    col: clampInteger(value?.col ?? value?.x, 0, columns - 1, fallbackTile.col),
    row: clampInteger(value?.row ?? value?.y, 0, rows - 1, fallbackTile.row),
  };
}

function normalizeWorldCollision(value, columns, rows) {
  const parts =
    typeof value === "string"
      ? value.split(",")
      : [value?.col ?? value?.x, value?.row ?? value?.y];
  const col = Number(parts[0]);
  const row = Number(parts[1]);

  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;

  const normalizedCol = Math.round(col);
  const normalizedRow = Math.round(row);

  if (
    normalizedCol < 0 ||
    normalizedCol >= columns ||
    normalizedRow < 0 ||
    normalizedRow >= rows
  ) {
    return null;
  }

  return `${normalizedCol},${normalizedRow}`;
}

function normalizeWorldZone(value, index, columns, rows) {
  if (!value || typeof value !== "object") return null;

  const bounds = value.bounds && typeof value.bounds === "object" ? value.bounds : value;
  const col = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
  const row = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
  const width = clampInteger(bounds.width ?? bounds.w, 1, columns - col, 1);
  const height = clampInteger(bounds.height ?? bounds.h, 1, rows - row, 1);
  const tabId = WORLD_NAVIGATION_TABS.has(String(value.tabId || "").trim())
    ? String(value.tabId).trim()
    : "space";
  const fallbackLabel = tabId === "space" ? "World" : tabId;
  const label = String(value.label || fallbackLabel).trim().slice(0, 72) || fallbackLabel;

  return {
    id: String(value.id || `zone-${index + 1}`).trim().slice(0, 64) || `zone-${index + 1}`,
    label,
    tabId,
    description: String(value.description || "").trim().slice(0, 160),
    bounds: {
      col,
      row,
      width,
      height,
    },
  };
}

function normalizeWorldObject(value, index, columns, rows) {
  if (!value || typeof value !== "object") return null;

  const assetId = String(value.assetId || "").trim().slice(0, 80);
  const src = String(value.src || "").trim();
  if (!assetId || !src.startsWith("/assets/limeets/")) return null;

  const col = clampInteger(value.col ?? value.x, 0, columns - 1, 0);
  const row = clampInteger(value.row ?? value.y, 0, rows - 1, 0);
  const width = clampInteger(value.width, 1, 12, 1);
  const height = clampInteger(value.height, 1, 12, 1);
  const interactionType = value.interactionType === "link" ? "link" : "none";
  const interactionValue = String(value.interactionValue || "").trim().slice(0, 500);

  return {
    id: String(value.id || `${assetId}-${index + 1}`).trim().slice(0, 96) || `${assetId}-${index + 1}`,
    assetId,
    label: String(value.label || assetId).trim().slice(0, 72) || assetId,
    src: src.slice(0, 220),
    col,
    row,
    width: Math.min(width, columns - col),
    height: Math.min(height, rows - row),
    blocks: value.blocks !== false,
    interactionType,
    interactionValue: interactionType === "link" ? interactionValue : "",
  };
}

function normalizeWorldPrivateArea(value, index, columns, rows) {
  if (!value || typeof value !== "object") return null;

  const bounds = value.bounds && typeof value.bounds === "object" ? value.bounds : value;
  const col = clampInteger(bounds.col ?? bounds.x, 0, columns - 1, 0);
  const row = clampInteger(bounds.row ?? bounds.y, 0, rows - 1, 0);
  const width = clampInteger(bounds.width ?? bounds.w, 1, columns - col, 1);
  const height = clampInteger(bounds.height ?? bounds.h, 1, rows - row, 1);
  const effects = value.effects && typeof value.effects === "object" && !Array.isArray(value.effects)
    ? value.effects
    : {};
  const properties = Array.isArray(value.properties)
    ? value.properties
        .map((property) => {
          if (!property || typeof property !== "object" || Array.isArray(property)) return null;
          const type = String(property.type || "").trim().slice(0, 48);
          if (!type) return null;
          return { ...property, type };
        })
        .filter(Boolean)
        .slice(0, 24)
    : [];
  const label =
    String(value.name || value.label || "Area")
      .trim()
      .slice(0, 72) || "Area";
  const roomId = String(value.roomId || value.mapId || "custom-world").trim().slice(0, 64) || "custom-world";
  const destination = normalizeWorldTeleporter(value.destination || value.teleporter, columns, rows, roomId);

  return {
    id: String(value.id || `area-${index + 1}`).trim().slice(0, 64) || `area-${index + 1}`,
    label,
    name: label,
    roomId,
    bounds: { col, row, width, height },
    effects: {
      entryExit: effects.entryExit === true,
      impassable: effects.impassable === true,
      meeting: effects.meeting === true,
      openLink: effects.openLink === true,
      teleport: effects.teleport === true,
    },
    properties,
    linkUrl: String(value.linkUrl || value.url || "").trim().slice(0, 500),
    openLinkInteraction: normalizeWorldOpenLinkInteraction(value.openLinkInteraction),
    openLinkNewTab: value.openLinkNewTab === true,
    tabId: normalizeWorldAreaTabId(value.tabId || value.targetTabId || value.portal?.tabId),
    destination: destination || { roomId, x: 0, y: 0 },
  };
}

function normalizeWorldOpenLinkInteraction(value) {
  return String(value || "").trim() === "enter" ? "enter" : "action";
}

function normalizeWorldAreaTabId(value) {
  const tabId = String(value || "").trim();
  return WORLD_NAVIGATION_TABS.has(tabId) && tabId !== "focus" ? tabId : "chat";
}

function normalizeWorldKey(value, columns, rows) {
  const parts = String(value || "").replace(/\s+/g, "").split(",");
  const col = Number(parts[0]);
  const row = Number(parts[1]);

  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;

  const x = Math.round(col);
  const y = Math.round(row);
  if (x < 0 || x >= columns || y < 0 || y >= rows) return null;
  return { x, y, key: `${x},${y}` };
}

function normalizeWorldLayerAsset(value) {
  return String(value || "").trim().slice(0, 96);
}

function normalizeWorldLayerStack(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeWorldLayerAsset(typeof item === "string" ? item : item?.assetId || item?.id))
      .filter(Boolean)
      .slice(0, 64);
  }

  const single = normalizeWorldLayerAsset(value);
  return single ? [single] : [];
}

function normalizeWorldPortal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tabId = WORLD_NAVIGATION_TABS.has(String(value.tabId || "").trim())
    ? String(value.tabId).trim()
    : "";
  if (!tabId) return null;

  return {
    tabId,
    label: String(value.label || tabId).trim().slice(0, 72) || tabId,
  };
}

function normalizeWorldTeleporter(value, columns, rows, fallbackRoomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    roomId: String(value.roomId || value.mapId || fallbackRoomId)
      .trim()
      .slice(0, 64) || fallbackRoomId,
    x: clampInteger(value.x ?? value.col, 0, columns - 1, 0),
    y: clampInteger(value.y ?? value.row, 0, rows - 1, 0),
  };
}

function normalizeWorldTileEntry(value, columns, rows, roomId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entry = {};
  const floor = normalizeWorldLayerAsset(value.floor);
  const aboveFloor = normalizeWorldLayerStack(value.above_floor);
  const object = normalizeWorldLayerStack(value.object);
  if (floor) entry.floor = floor;
  if (aboveFloor.length) entry.above_floor = aboveFloor;
  if (object.length) entry.object = object;
  if (value.impassable === true) entry.impassable = true;

  const privateAreaId = String(value.privateAreaId || "").trim().slice(0, 72);
  if (privateAreaId) entry.privateAreaId = privateAreaId;

  const teleporter = normalizeWorldTeleporter(value.teleporter, columns, rows, roomId);
  if (teleporter) entry.teleporter = teleporter;

  const portal = normalizeWorldPortal(value.portal);
  if (portal) entry.portal = portal;

  const openUrl = String(value.openUrl || value.linkUrl || "").trim().slice(0, 500);
  if (openUrl) entry.openUrl = openUrl;

  if (value.entryExit === true) entry.entryExit = true;

  return Object.keys(entry).length ? entry : null;
}

function normalizeWorldTilemap(value, columns, rows, roomId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};
  let count = 0;

  for (const [rawKey, rawTile] of Object.entries(source)) {
    if (count >= WORLD_CONFIG_MAX_TILES) break;
    const parsed = normalizeWorldKey(rawKey, columns, rows);
    if (!parsed) continue;

    const tile = normalizeWorldTileEntry(rawTile, columns, rows, roomId);
    if (!tile) continue;

    normalized[parsed.key] = tile;
    count += 1;
  }

  return normalized;
}

function ensureWorldTile(tilemap, x, y) {
  const key = `${x},${y}`;
  tilemap[key] = tilemap[key] || {};
  return tilemap[key];
}

function migrateLegacyWorldTilemap(config, columns, rows) {
  const tilemap = {};

  (Array.isArray(config.collisions) ? config.collisions : []).forEach((collision) => {
    const normalized = normalizeWorldCollision(collision, columns, rows);
    if (!normalized) return;
    const [x, y] = normalized.split(",").map(Number);
    ensureWorldTile(tilemap, x, y).impassable = true;
  });

  (Array.isArray(config.objects) ? config.objects : []).forEach((object) => {
    const assetId = normalizeWorldLayerAsset(object?.assetId);
    if (!assetId) return;
    const x = clampInteger(object.col ?? object.x, 0, columns - 1, 0);
    const y = clampInteger(object.row ?? object.y, 0, rows - 1, 0);
    ensureWorldTile(tilemap, x, y).object = assetId;
  });

  (Array.isArray(config.privateAreas) ? config.privateAreas : []).forEach((area, index) => {
    const normalized = normalizeWorldPrivateArea(area, index, columns, rows);
    if (!normalized) return;
    const { col, row, width, height } = normalized.bounds;
    for (let y = row; y < row + height; y += 1) {
      for (let x = col; x < col + width; x += 1) {
        ensureWorldTile(tilemap, x, y).privateAreaId = normalized.id;
      }
    }
  });

  (Array.isArray(config.zones) ? config.zones : []).forEach((zone, index) => {
    const normalized = normalizeWorldZone(zone, index, columns, rows);
    if (!normalized) return;
    const { col, row, width, height } = normalized.bounds;
    for (let y = row; y < row + height; y += 1) {
      for (let x = col; x < col + width; x += 1) {
        ensureWorldTile(tilemap, x, y).portal = {
          tabId: normalized.tabId,
          label: normalized.label,
        };
      }
    }
  });

  return tilemap;
}

function normalizeWorldRoom(value, index, columns, rows) {
  const room = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackId = index === 0 ? "custom-world" : `world-room-${index + 1}`;
  const id = String(room.id || room.roomId || room.mapId || fallbackId)
    .trim()
    .slice(0, 64) || fallbackId;

  return {
    id,
    name: String(room.name || (index === 0 ? "World" : `Room ${index + 1}`))
      .trim()
      .slice(0, 72) || "World",
    tilemap: normalizeWorldTilemap(room.tilemap, columns, rows, id),
  };
}

function normalizeWorldConfig(value) {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const columns = clampInteger(config.columns, 12, 256, WORLD_CONFIG_DEFAULT.columns);
  const rows = clampInteger(config.rows, 10, 256, WORLD_CONFIG_DEFAULT.rows);
  const backgroundImage = normalizeWorldImage(config.backgroundImage);
  const sourceRooms =
    Array.isArray(config.rooms) && config.rooms.length
      ? config.rooms
      : [
          {
            id: "custom-world",
            name: "World",
            tilemap: migrateLegacyWorldTilemap(config, columns, rows),
          },
        ];
  const rooms = sourceRooms
    .map((room, index) => normalizeWorldRoom(room, index, columns, rows))
    .filter((room) => room.id && room.name)
    .slice(0, WORLD_CONFIG_MAX_ROOMS);
  if (!rooms.length) rooms.push(WORLD_CONFIG_DEFAULT.rooms[0]);
  const activeRoomId = rooms.some((room) => room.id === config.activeRoomId)
    ? String(config.activeRoomId).trim().slice(0, 64)
    : rooms[0].id;
  const spawnSource = config.spawnpoint || config.spawn || WORLD_CONFIG_DEFAULT.spawnpoint;
  const spawnpoint = {
    roomId: String(spawnSource?.roomId || spawnSource?.mapId || rooms[0].id)
      .trim()
      .slice(0, 64) || rooms[0].id,
    x: clampInteger(spawnSource?.x ?? spawnSource?.col, 0, columns - 1, Math.floor(columns / 2)),
    y: clampInteger(spawnSource?.y ?? spawnSource?.row, 0, rows - 1, Math.floor(rows / 2)),
  };
  if (!rooms.some((room) => room.id === spawnpoint.roomId)) {
    spawnpoint.roomId = rooms[0].id;
  }
  const collisions = Array.from(
    new Set(
      (Array.isArray(config.collisions) ? config.collisions : [])
        .map((collision) => normalizeWorldCollision(collision, columns, rows))
        .filter(Boolean),
    ),
  ).slice(0, WORLD_CONFIG_MAX_COLLISIONS);
  const zones = (Array.isArray(config.zones) ? config.zones : [])
    .map((zone, index) => normalizeWorldZone(zone, index, columns, rows))
    .filter(Boolean)
    .slice(0, WORLD_CONFIG_MAX_ZONES);
  const objects = (Array.isArray(config.objects) ? config.objects : [])
    .map((object, index) => normalizeWorldObject(object, index, columns, rows))
    .filter(Boolean)
    .slice(0, WORLD_CONFIG_MAX_OBJECTS);
  const privateAreas = (Array.isArray(config.privateAreas) ? config.privateAreas : [])
    .map((area, index) => normalizeWorldPrivateArea(area, index, columns, rows))
    .filter(Boolean)
    .slice(0, WORLD_CONFIG_MAX_ZONES);

  return {
    enabled: config.enabled !== false,
    version: 2,
    backgroundImage,
    tileSize: clampInteger(config.tileSize, 16, 72, WORLD_CONFIG_DEFAULT.tileSize),
    columns,
    rows,
    activeRoomId,
    spawnpoint,
    spawn: { mapId: spawnpoint.roomId, col: spawnpoint.x, row: spawnpoint.y },
    rooms,
    collisions,
    objects,
    privateAreas,
    zones,
  };
}

function normalizeFolder(value) {
  const folder = String(value || "General")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return folder.slice(0, 180) || "General";
}

function normalizeOptionalFolder(value) {
  return String(value || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/")
    .slice(0, 180);
}

function isCanvasFolderPath(value) {
  const folder = normalizeOptionalFolder(value);
  return folder === "Canvas" || folder.startsWith("Canvas/");
}

function isCanvasSyncedResource(resource) {
  return resource?.metadata?.source === "canvas-file" || isCanvasFolderPath(resource?.folder);
}

const RESOURCE_FILE_SIZE_LIMIT = 12 * 1024 * 1024;
const resourceFileSizeLabel = "12 MB";
const blockedResourceUploadExtensions = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dmg",
  ".exe",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".vb",
  ".vbs",
  ".wsf",
]);

function isBlockedResourceUpload(file) {
  const extension = path.extname(file?.originalname || "").toLowerCase();
  return blockedResourceUploadExtensions.has(extension);
}

const resourceTypeRules = [
  { type: "Lecture Notes", patterns: [/lecture/i, /\blec\b/i, /slides?/i, /notes?/i, /session/i] },
  { type: "Tutorial", patterns: [/tutorial/i, /\btut\b/i, /worksheet/i, /problem\s*set/i] },
  { type: "Past Year Paper", patterns: [/past/i, /\bpyp\b/i, /exam/i, /final/i, /midterm/i, /paper/i] },
  { type: "Cheatsheet", patterns: [/cheat/i, /summary/i, /formula/i, /quick\s*ref/i] },
  { type: "Assignment", patterns: [/assignment/i, /\bassg\b/i, /homework/i, /project/i] },
  { type: "Lab", patterns: [/\blab\b/i, /practical/i, /experiment/i] },
  { type: "Quiz", patterns: [/quiz/i, /test/i] },
];

const topicStopWords = new Set([
  "lecture",
  "lect",
  "notes",
  "note",
  "tutorial",
  "slides",
  "slide",
  "session",
  "week",
  "final",
  "midterm",
  "exam",
  "paper",
  "assignment",
  "lab",
  "quiz",
  "copy",
  "full",
  "official",
  "unofficial",
]);

/** Returns a stable SHA-256 hash so exact duplicate uploads can be rejected room-wide. */
async function hashUploadedFile(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function compactResourceName(value = "") {
  return String(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferResourceTypeFromName(name = "") {
  const match = resourceTypeRules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(name)),
  );

  return match?.type || "Reference";
}

function inferTopicFromName(name = "", room) {
  const moduleCode = String(room?.moduleCode || "").toLowerCase();
  const tokens = compactResourceName(name)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && token !== moduleCode && !topicStopWords.has(token));

  return tokens.slice(0, 5).join(" ") || inferResourceTypeFromName(name);
}

function inferVersionFromName(name = "") {
  const match = String(name).match(/\b(?:v|version)\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  return match ? `v${match[1]}` : "v1";
}

/**
 * Adds NUS-study-specific browsing metadata at upload time.
 * The rules are intentionally transparent so members can later override them manually.
 */
function buildResourceMetadata({ room, title, sourceType, mimeType = "", size = 0, url = "" }) {
  const extension = path.extname(new URL(url || title, "http://local").pathname).replace(".", "");
  const resourceType = inferResourceTypeFromName(title);
  const topic = inferTopicFromName(title, room);
  const tags = [
    resourceType,
    topic,
    room?.moduleCode,
    room?.academicTerm,
    extension ? extension.toUpperCase() : "",
  ].filter(Boolean);

  return {
    resourceType,
    type: resourceType,
    topic,
    module: room?.moduleCode || "",
    semester: room?.academicTerm || "",
    version: inferVersionFromName(title),
    source: sourceType,
    extension,
    mimeType,
    size,
    tags: [...new Set(tags)].slice(0, 8),
    extractedAt: new Date().toISOString(),
  };
}

function normalizeChannel(value) {
  const channel = String(value || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 32);

  return channel || "general";
}

function normalizeChannels(value) {
  const seen = new Set();
  const result = [];
  const general = { name: "general", type: "text", resourceId: "" };
  result.push(general);
  seen.add("general");

  for (const channel of Array.isArray(value) ? value : []) {
    const name = normalizeChannel(typeof channel === "string" ? channel : channel?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      type: typeof channel === "object" && channel?.type === "document" ? "document" : "text",
      resourceId: typeof channel === "object" ? String(channel?.resourceId || "") : "",
    });
  }

  return result.slice(0, 20);
}

const DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID = "default-text-channels";

function normalizeLayoutChannelName(value) {
  const raw = String(value || "").trim();
  return raw ? normalizeChannel(raw) : "";
}

function normalizeRoomChannelLayout(layout, channels = []) {
  const channelNames = normalizeChannels(channels).map((channel) => channel.name);
  const channelSet = new Set(channelNames);
  const seenChannels = new Set();
  const categories = Array.isArray(layout)
    ? layout
        .filter((category) => category && typeof category === "object" && category.id && category.name)
        .map((category) => ({
          id: String(category.id).slice(0, 80),
          name: String(category.name).trim().slice(0, 80) || "Text Channels",
          channels: Array.isArray(category.channels)
            ? category.channels
                .map(normalizeLayoutChannelName)
                .filter((channel) => {
                  if (!channelSet.has(channel) || seenChannels.has(channel)) return false;
                  seenChannels.add(channel);
                  return true;
                })
            : [],
        }))
    : [];

  const uncategorized = channelNames.filter((channel) => !seenChannels.has(channel));
  const defaultIndex = categories.findIndex((category) => category.id === DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID);

  if (defaultIndex >= 0) {
    categories[defaultIndex] = {
      ...categories[defaultIndex],
      channels: [...categories[defaultIndex].channels, ...uncategorized],
    };
  } else {
    categories.unshift({
      id: DEFAULT_CHANNEL_LAYOUT_CATEGORY_ID,
      name: "Text Channels",
      channels: uncategorized,
    });
  }

  return categories;
}

function renameChannelInRoomLayout(layout, channels, oldChannel, newChannel) {
  return normalizeRoomChannelLayout(layout, channels).map((category) => ({
    ...category,
    channels: category.channels.map((channel) => (channel === oldChannel ? newChannel : channel)),
  }));
}

function findNormalizedRoomChannel(room, value) {
  const channel = normalizeChannel(value);
  return normalizeChannels(room?.channels).find((candidate) => candidate.name === channel) || null;
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeAnnotationType(value) {
  return ["question", "key-point", "definition", "mistake", "insight", "general"].includes(value)
    ? value
    : "general";
}

function getAnnotationAuthorId(annotation) {
  return String(annotation?.author?.id || "");
}

function normalizeAnnotationReply(reply) {
  return {
    id: String(reply?.id || createId("annr")),
    author: normalizePlainObject(reply?.author),
    comment: String(reply?.comment || "").slice(0, 4000),
    createdAt: reply?.createdAt || new Date().toISOString(),
  };
}

function annotationDto(annotation) {
  const createdAt = annotation.createdAt || new Date().toISOString();
  return {
    id: annotation.id,
    roomId: annotation.roomId,
    channel: normalizeChannel(annotation.channel),
    resourceId: String(annotation.resourceId || ""),
    position: normalizePlainObject(annotation.position),
    content: normalizePlainObject(annotation.content),
    comment: String(annotation.comment || ""),
    annotationType: normalizeAnnotationType(annotation.annotationType),
    resolved: Boolean(annotation.resolved),
    author: normalizePlainObject(annotation.author),
    replies: Array.isArray(annotation.replies) ? annotation.replies.map(normalizeAnnotationReply) : [],
    createdAt,
    updatedAt: annotation.updatedAt || createdAt,
  };
}

function createAnnotationRecord(room, channel, user, body = {}) {
  const now = new Date().toISOString();
  return annotationDto({
    id: createId("ann"),
    roomId: room.id,
    channel: channel.name,
    resourceId: channel.resourceId || "",
    position: normalizePlainObject(body.position),
    content: normalizePlainObject(body.content),
    comment: String(body.comment || "").trim().slice(0, 4000),
    annotationType: normalizeAnnotationType(body.annotationType),
    resolved: false,
    author: publicUser(user),
    replies: [],
    createdAt: now,
    updatedAt: now,
  });
}

function findAnnotationForChannel(db, room, channel, annotationId) {
  const id = String(annotationId || "");
  return db.annotations.find(
    (annotation) =>
      annotation.id === id &&
      annotation.roomId === room.id &&
      normalizeChannel(annotation.channel) === channel.name,
  );
}

function updateAnnotationRecord(annotation, user, body = {}) {
  const ownsAnnotation = getAnnotationAuthorId(annotation) === user.id;
  const hasComment = Object.prototype.hasOwnProperty.call(body, "comment");
  const hasAnnotationType = Object.prototype.hasOwnProperty.call(body, "annotationType");
  const hasResolved = Object.prototype.hasOwnProperty.call(body, "resolved");

  if ((hasComment || hasAnnotationType) && !ownsAnnotation) {
    return { status: 403, message: "You can only edit your own annotation notes." };
  }

  let changed = false;
  if (hasComment) {
    annotation.comment = String(body.comment || "").trim().slice(0, 4000);
    changed = true;
  }

  if (hasAnnotationType) {
    annotation.annotationType = normalizeAnnotationType(body.annotationType);
    changed = true;
  }

  if (hasResolved) {
    annotation.resolved = Boolean(body.resolved);
    changed = true;
  }

  if (changed) annotation.updatedAt = new Date().toISOString();
  return { annotation: annotationDto(annotation) };
}

function addAnnotationReply(annotation, user, body = {}) {
  const comment = String(body.comment || "").trim().slice(0, 4000);
  if (!comment) {
    return { status: 400, message: "Reply comment is required." };
  }

  const reply = {
    id: createId("annr"),
    author: publicUser(user),
    comment,
    createdAt: new Date().toISOString(),
  };
  annotation.replies = [...(Array.isArray(annotation.replies) ? annotation.replies : []), reply];
  annotation.updatedAt = reply.createdAt;
  return { annotation: annotationDto(annotation), reply };
}

function deleteAnnotationReply(annotation, room, user, replyId) {
  const id = String(replyId || "");
  const replies = Array.isArray(annotation.replies) ? annotation.replies : [];
  const reply = replies.find((candidate) => String(candidate?.id || "") === id);

  if (!reply) {
    return { status: 404, message: "Reply not found." };
  }

  const ownsReply = String(reply.author?.id || "") === user.id;
  const ownsAnnotation = getAnnotationAuthorId(annotation) === user.id;
  const ownsRoom = room.ownerId === user.id;

  if (!ownsReply && !ownsAnnotation && !ownsRoom) {
    return { status: 403, message: "Only the reply author, annotation author, or room owner can delete it." };
  }

  annotation.replies = replies.filter((candidate) => String(candidate?.id || "") !== id);
  annotation.updatedAt = new Date().toISOString();
  return { annotation: annotationDto(annotation), replyId: id };
}

function normalizeMessageAttachments(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((attachment) => ({
      id: String(attachment?.id || "").trim(),
      title: String(attachment?.title || attachment?.name || "Attachment").trim(),
      url: String(attachment?.url || "").trim(),
      type: String(attachment?.type || "file").trim(),
      size: Number(attachment?.size || 0),
    }))
    .filter((attachment) => attachment.id && attachment.url)
    .slice(0, 8);
}

function normalizeBuddyMessageChain(value) {
  if (!Array.isArray(value)) return [];

  // Keep only the real chat text that the member and Intelligrate exchanged. The app
  // should not add extra assistant notes or instructions here.
  return value
    .filter((message) => !message?.interrupted)
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";

      return {
        role,
        content: String(message?.content || message?.body || "")
          .trim()
          .slice(0, 4000),
      };
    })
    .filter((message) => message.content)
    .slice(-12);
}

function getResourceExtension(resource) {
  const source =
    resource?.originalName || resource?.storageName || resource?.title || resource?.url || "";

  try {
    return path.extname(new URL(source, "http://local").pathname).toLowerCase();
  } catch {
    return path.extname(source).toLowerCase();
  }
}

function detectResourceType(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase();
  const extension = String(filename || "").split(".").pop()?.toLowerCase() || "";

  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    extension === "docx" ||
    extension === "doc"
  ) {
    return "docx";
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint" ||
    extension === "pptx" ||
    extension === "ppt"
  ) {
    return "pptx";
  }
  if (mime.startsWith("image/")) return "image";
  return "other";
}

function uploadUrl(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return null;
  return `/uploads/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

async function convertToPdf(inputPath) {
  const outputDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${baseName}.pdf`);
  if (fs.existsSync(outputPath)) {
    await fs.promises.unlink(outputPath);
  }

  const libreOfficeBinary = process.env.LIBREOFFICE_BIN || "libreoffice";
  await execFileAsync(
    libreOfficeBinary,
    ["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", outputDir, inputPath],
    {
      timeout: 180_000,
      windowsHide: true,
      env: { ...process.env, HOME: process.env.HOME || serverRootDir },
    },
  );

  if (!fs.existsSync(outputPath)) {
    throw new Error("LibreOffice did not produce a PDF output file.");
  }
  return outputPath;
}

function relativeUploadPath(filePath) {
  return path.relative(uploadDir, filePath).replace(/\\/g, "/");
}

const activeResourceConversions = new Set();
const OFFICE_PDF_CONVERSION_VERSION = "office-fonts-v2";

function startResourcePdfConversion({ resourceId, roomId, storageName }) {
  if (activeResourceConversions.has(resourceId)) return;
  activeResourceConversions.add(resourceId);

  materializeUploadFile(storageName)
    .then((inputPath) => {
      if (!inputPath) throw new Error("Resource file not found for conversion.");
      return convertToPdf(inputPath);
    })
    .then(async (pdfPath) => {
      const db = await readDb();
      const resource = db.resources.find((candidate) => candidate.id === resourceId);
      if (!resource) return;

      resource.pdfPath = relativeUploadPath(pdfPath);
      await persistUploadBlobFromPath(resource.pdfPath, pdfPath, {
        mimeType: "application/pdf",
        originalName: `${path.basename(resource.originalName || resource.title || resource.storageName || "document", path.extname(resource.originalName || resource.title || resource.storageName || ""))}.pdf`,
      });
      resource.pdfConversionVersion = OFFICE_PDF_CONVERSION_VERSION;
      resource.conversionStatus = "done";
      await writeDb(db);

      io.to(`room:${roomId}`).emit("resource:conversion-done", {
        roomId,
        resourceId,
        pdfUrl: uploadUrl(resource.pdfPath),
        conversionStatus: "done",
      });
    })
    .catch(async (error) => {
      console.error("Resource PDF conversion failed:", error);
      const db = await readDb();
      const resource = db.resources.find((candidate) => candidate.id === resourceId);
      if (!resource) return;

      resource.pdfPath = "";
      resource.pdfConversionVersion = "";
      resource.conversionStatus = "failed";
      await writeDb(db);

      io.to(`room:${roomId}`).emit("resource:conversion-done", {
        roomId,
        resourceId,
        conversionStatus: "failed",
      });
    })
    .finally(() => {
      activeResourceConversions.delete(resourceId);
    });
}

async function ensureOfficeResourceConversion(db, resource) {
  const resourceType = getEffectiveResourceType(resource);
  if (resourceType !== "docx" && resourceType !== "pptx") return false;

  let changed = false;
  if (resource.resourceType !== resourceType) {
    resource.resourceType = resourceType;
    changed = true;
  }

  if (resource.pdfPath) {
    if (resource.pdfConversionVersion === OFFICE_PDF_CONVERSION_VERSION) {
      if (resource.conversionStatus !== "done") {
        resource.conversionStatus = "done";
        changed = true;
      }
      return changed;
    }

    if (resource.conversionStatus !== "pending") {
      resource.conversionStatus = "pending";
      changed = true;
    }
    if (resource.pdfConversionVersion) {
      resource.pdfConversionVersion = "";
      changed = true;
    }
  } else if (resource.conversionStatus === "done") {
    resource.conversionStatus = "pending";
    changed = true;
  }

  if (!resource.storageName || resource.deletedAt) return changed;
  if (resource.conversionStatus === "failed") return changed;
  if (resource.conversionStatus === "pending" && activeResourceConversions.has(resource.id)) {
    return changed;
  }

  if (resource.conversionStatus !== "pending") {
    resource.conversionStatus = "pending";
    changed = true;
  }

  startResourcePdfConversion({
    resourceId: resource.id,
    roomId: resource.roomId,
    storageName: resource.storageName,
  });
  return changed;
}

const documentChannelMimePatterns = [
  /^application\/pdf\b/i,
  /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\b/i,
  /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation\b/i,
  /^image\/png\b/i,
  /^image\/jpe?g\b/i,
  /^image\/webp\b/i,
];
const documentChannelExtensions = new Set([".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"]);
const documentChannelFileTypeMessage =
  "Document channels support PDF, DOCX, PPTX, PNG, JPG, JPEG, or WEBP files only.";

function isDocumentChannelUploadFile(file) {
  if (!file) return false;
  const mimeType = String(file.mimetype || "").toLowerCase();
  const extension = path.extname(file.originalname || "").toLowerCase();

  return (
    documentChannelMimePatterns.some((pattern) => pattern.test(mimeType)) ||
    documentChannelExtensions.has(extension)
  );
}

function isDocumentChannelResource(resource) {
  if (!resource || resource.deletedAt || resource.type !== "file") return false;
  const mimeType = String(resource.mimeType || "").toLowerCase();
  const extension = getResourceExtension(resource);

  return (
    documentChannelMimePatterns.some((pattern) => pattern.test(mimeType)) ||
    documentChannelExtensions.has(extension)
  );
}

function isChatbotDocument(resource) {
  return (
    ["file", "url"].includes(resource?.type) &&
    chatbotDocumentExtensions.has(getResourceExtension(resource))
  );
}

function isChatbotFileResource(resource) {
  return resource?.type === "file" && chatbotDocumentExtensions.has(getResourceExtension(resource));
}

function resourceUrlForChatbot(resource) {
  if (!isChatbotDocument(resource)) return null;
  return resource.url || (resource.storageName ? `/uploads/${resource.storageName}` : null);
}

function chatbotDocumentPayload(resource) {
  const url = resourceUrlForChatbot(resource);
  if (!url) return null;

  return {
    url,
    file_name: resource.originalName || resource.title || resource.storageName || url,
  };
}

const DOMAIN_CORPUS_TEXT_LIMIT = 6000;
const DOMAIN_CORPUS_MAX_MESSAGES = 1000;
const DOMAIN_CORPUS_SCHEMA_VERSION = "2026-07-13-domain-source-temporal-v3";
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || "Asia/Singapore";

function compactDomainCorpusText(value, limit = DOMAIN_CORPUS_TEXT_LIMIT) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function sourceDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      timeZone: APP_TIMEZONE,
      year: "numeric",
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return byType.year && byType.month && byType.day ? `${byType.year}-${byType.month}-${byType.day}` : "";
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function sourceTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function domainResourceSourceRef(resource) {
  const label = resource.originalName || resource.title || resource.storageName || resource.url || "Resource";
  return {
    type: "resource",
    roomId: resource.roomId,
    label,
    resourceId: resource.id,
    sourceId: resource.id,
    folder: resource.folder || "General",
  };
}

function domainCorpusFilePayload(resource) {
  const payload = chatbotDocumentPayload(resource);
  if (!payload) return null;

  return {
    ...payload,
    id: resource.id,
    source_type: "resource",
    source_ref: domainResourceSourceRef(resource),
    metadata: {
      resource_id: resource.id,
      folder: resource.folder || "General",
      title: resource.title || "",
      original_name: resource.originalName || "",
      storage_name: resource.storageName || "",
      mime_type: resource.mimeType || "",
      content_hash: resource.contentHash || "",
      updated_at: resource.updatedAt || resource.createdAt || "",
    },
  };
}

function domainCorpusDocument(id, sourceType, title, text, sourceRef, metadata: any = {}) {
  const cleanedText = compactDomainCorpusText(text);
  if (!id || !sourceType || !cleanedText) return null;

  return {
    id,
    source_type: sourceType,
    title: String(title || sourceRef?.label || id).slice(0, 180),
    text: cleanedText,
    source_ref: sourceRef,
    metadata,
  };
}

function buildConvolutionCorpusDocuments(db, room) {
  return db.messages
    .filter((message) => message.roomId === room.id && String(message.body || "").trim())
    .slice(-DOMAIN_CORPUS_MAX_MESSAGES)
    .map((message) => {
      const channel = normalizeChannel(message.channel || "general");
      const sender = publicUser(db.users.find((user) => user.id === message.senderId));
      const attachmentNames = normalizeMessageAttachments(message.attachments)
        .map((attachment) => attachment.title)
        .filter(Boolean);
      const label = `#${channel} message`;
      const text = [
        `Convolution channel: #${channel}`,
        sender?.name ? `Author: ${sender.name}` : "",
        message.createdAt ? `Sent at: ${message.createdAt}` : "",
        `Message: ${message.body}`,
        attachmentNames.length ? `Attachments: ${attachmentNames.join(", ")}` : "",
      ].filter(Boolean).join("\n");

      return domainCorpusDocument(
        `message:${message.id}`,
        "convolution_message",
        label,
        text,
        {
          type: "convolution_message",
          roomId: room.id,
          label,
          channel,
          messageId: message.id,
          sourceId: message.id,
          createdAt: message.createdAt || "",
        },
        {
          source_id: message.id,
          message_id: message.id,
          channel,
          created_at: message.createdAt || "",
          updated_at: message.updatedAt || message.createdAt || "",
        },
      );
    })
    .filter(Boolean);
}

function buildAnnotationCorpusDocuments(db, room) {
  return db.annotations
    .filter((annotation) => annotation.roomId === room.id)
    .map((annotation) => {
      const channel = normalizeChannel(annotation.channel || "general");
      const quotedText = String(annotation.content?.text || "").trim();
      const replies = Array.isArray(annotation.replies)
        ? annotation.replies.map((reply) => reply.comment).filter(Boolean)
        : [];
      const label = quotedText
        ? `Annotation on "${compactDomainCorpusText(quotedText, 48)}"`
        : `Annotation in #${channel}`;
      const text = [
        `Annotation channel: #${channel}`,
        annotation.resourceId ? `Resource id: ${annotation.resourceId}` : "",
        quotedText ? `Highlighted text: ${quotedText}` : "",
        annotation.comment ? `Comment: ${annotation.comment}` : "",
        replies.length ? `Replies: ${replies.join(" | ")}` : "",
      ].filter(Boolean).join("\n");

      return domainCorpusDocument(
        `annotation:${annotation.id}`,
        "annotation",
        label,
        text,
        {
          type: "annotation",
          roomId: room.id,
          label,
          channel,
          annotationId: annotation.id,
          resourceId: annotation.resourceId || "",
          sourceId: annotation.id,
          textQuote: quotedText,
        },
        {
          source_id: annotation.id,
          annotation_id: annotation.id,
          resource_id: annotation.resourceId || "",
          channel,
          updated_at: annotation.updatedAt || annotation.createdAt || "",
        },
      );
    })
    .filter(Boolean);
}

function buildCoordidateCorpusDocuments(db, room) {
  const sessionDocuments = db.sessions
    .filter((session) => session.roomId === room.id && session.visibility !== "private")
    .map((session) => {
      const label = session.title || "Coordidate session";
      const date = sourceDate(session.startsAt);
      const startTs = sourceTimestamp(session.startsAt);
      const endTs = sourceTimestamp(session.endsAt) || startTs;
      const text = [
        `Coordidate ${session.kind || "session"}: ${label}`,
        session.agenda ? `Agenda: ${session.agenda}` : "",
        session.startsAt ? `Starts at: ${session.startsAt}` : "",
        session.endsAt ? `Ends at: ${session.endsAt}` : "",
        session.location ? `Location: ${session.location}` : "",
      ].filter(Boolean).join("\n");

      return domainCorpusDocument(
        `session:${session.id}`,
        "coordidate_session",
        label,
        text,
        {
          type: "coordidate_session",
          roomId: room.id,
          label,
          sessionId: session.id,
          sourceId: session.id,
          startsAt: session.startsAt || "",
          endsAt: session.endsAt || "",
          date,
        },
        {
          source_id: session.id,
          session_id: session.id,
          date,
          start_ts: startTs,
          end_ts: endTs,
          starts_at: session.startsAt || "",
          ends_at: session.endsAt || "",
          kind: session.kind || "meeting",
          updated_at: session.updatedAt || session.createdAt || "",
        },
      );
    });

  const pollDocuments = (db.coordinatePolls || [])
    .filter((poll) => poll.roomId === room.id)
    .map((poll) => {
      const responses = (db.coordinateResponses || []).filter((response) => response.pollId === poll.id);
      const label = poll.title || "Coordidate poll";
      const date = sourceDate(poll.rangeStart || poll.createdAt);
      const rangeStartTs = sourceTimestamp(poll.rangeStart);
      const rangeEndTs = sourceTimestamp(poll.rangeEnd) || rangeStartTs;
      const selectedDates = Array.isArray(poll.selectedDates) ? poll.selectedDates.join(", ") : "";
      const text = [
        `Coordidate poll: ${label}`,
        poll.rangeStart ? `Range starts: ${poll.rangeStart}` : "",
        poll.rangeEnd ? `Range ends: ${poll.rangeEnd}` : "",
        selectedDates ? `Selected dates: ${selectedDates}` : "",
        `Responses: ${responses.length}`,
      ].filter(Boolean).join("\n");

      return domainCorpusDocument(
        `poll:${poll.id}`,
        "coordidate_poll",
        label,
        text,
        {
          type: "coordidate_poll",
          roomId: room.id,
          label,
          pollId: poll.id,
          sourceId: poll.id,
          date,
          startsAt: poll.rangeStart || "",
        },
        {
          source_id: poll.id,
          poll_id: poll.id,
          date,
          range_start_ts: rangeStartTs,
          range_end_ts: rangeEndTs,
          starts_at: poll.rangeStart || "",
          ends_at: poll.rangeEnd || "",
          updated_at: poll.updatedAt || poll.createdAt || "",
        },
      );
    });

  return [...sessionDocuments, ...pollDocuments].filter(Boolean);
}

function buildDomainCorpusPayload(db, room) {
  const supportedResources = db.resources.filter(
    (resource) => resource.roomId === room.id && !resource.deletedAt && isChatbotDocument(resource),
  );

  return {
    room_id: room.id,
    files: supportedResources.map(domainCorpusFilePayload).filter(Boolean),
    documents: [
      ...buildConvolutionCorpusDocuments(db, room),
      ...buildAnnotationCorpusDocuments(db, room),
      ...buildCoordidateCorpusDocuments(db, room),
    ],
  };
}

function domainCorpusFingerprint(corpus) {
  return JSON.stringify({
    schema: DOMAIN_CORPUS_SCHEMA_VERSION,
    timezone: APP_TIMEZONE,
    files: corpus.files
      .map((file) => ({
        id: file.id || "",
        url: file.url || "",
        name: file.file_name || "",
        hash: file.metadata?.content_hash || "",
        updatedAt: file.metadata?.updated_at || "",
      }))
      .sort((a, b) => `${a.id}:${a.hash}:${a.updatedAt}`.localeCompare(`${b.id}:${b.hash}:${b.updatedAt}`)),
    documents: corpus.documents
      .map((document) => ({
        id: document.id,
        metadata: document.metadata || {},
        sourceRef: document.source_ref || {},
        type: document.source_type,
        text: document.text,
        updatedAt: document.metadata?.updated_at || "",
      }))
      .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
  });
}

function sourceNameKey(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  const withoutQuery = cleaned.split(/[?#]/)[0];
  const fileName = withoutQuery.split(/[\\/]/).pop() || withoutQuery;
  try {
    return decodeURIComponent(fileName).toLowerCase();
  } catch {
    return fileName.toLowerCase();
  }
}

function findRoomResourceForSource(db, room, source) {
  const resourceId = String(source?.resourceId || source?.sourceId || "").trim();
  if (resourceId) {
    const resource = db.resources.find(
      (candidate) => candidate.id === resourceId && candidate.roomId === room.id && !candidate.deletedAt,
    );
    if (resource) return resource;
  }

  const labelKey = sourceNameKey(source?.label || source);
  if (!labelKey) return null;
  return db.resources.find((resource) => {
    if (resource.roomId !== room.id || resource.deletedAt) return false;
    return [resource.title, resource.originalName, resource.storageName, resource.url]
      .map(sourceNameKey)
      .some((key) => key && key === labelKey);
  }) || null;
}

function enrichBuddySourceForRoom(db, room, source, userId) {
  const normalized = normalizeBuddySourceRef(source);
  if (!normalized) return null;

  if (typeof normalized === "string") {
    const resource = findRoomResourceForSource(db, room, normalized);
    return resource
      ? {
          type: "resource",
          roomId: room.id,
          label: resource.originalName || resource.title || resource.storageName || normalized,
          resourceId: resource.id,
          sourceId: resource.id,
          folder: resource.folder || "General",
        }
      : normalized;
  }

  if (normalized.roomId && normalized.roomId !== room.id) return null;

  if (normalized.type === "resource") {
    const resource = findRoomResourceForSource(db, room, normalized);
    if (!resource) return null;
    return {
      ...normalized,
      roomId: room.id,
      label: resource.originalName || resource.title || resource.storageName || normalized.label,
      resourceId: resource.id,
      sourceId: resource.id,
      folder: resource.folder || "General",
    };
  }

  if (normalized.type === "convolution_message") {
    const message = db.messages.find(
      (candidate) => candidate.id === normalized.messageId && candidate.roomId === room.id,
    );
    if (!message) return null;
    const channel = normalizeChannel(message.channel || normalized.channel || "general");
    return {
      ...normalized,
      roomId: room.id,
      label: normalized.label || `#${channel} message`,
      channel,
      messageId: message.id,
      sourceId: message.id,
    };
  }

  if (normalized.type === "annotation") {
    const annotation = db.annotations.find(
      (candidate) => candidate.id === normalized.annotationId && candidate.roomId === room.id,
    );
    if (!annotation) return null;
    return {
      ...normalized,
      roomId: room.id,
      channel: normalizeChannel(annotation.channel || normalized.channel || "general"),
      annotationId: annotation.id,
      resourceId: annotation.resourceId || normalized.resourceId,
      sourceId: annotation.id,
      textQuote: normalized.textQuote || annotation.content?.text || "",
    };
  }

  if (normalized.type === "coordidate_session") {
    const session = db.sessions.find(
      (candidate) =>
        candidate.id === normalized.sessionId &&
        candidate.roomId === room.id &&
        candidate.visibility !== "private" &&
        isSessionVisibleToUser(candidate, userId),
    );
    if (!session) return null;
    return {
      ...normalized,
      roomId: room.id,
      label: session.title || normalized.label,
      sessionId: session.id,
      sourceId: session.id,
      date: sourceDate(session.startsAt),
      startsAt: session.startsAt || "",
    };
  }

  if (normalized.type === "coordidate_poll") {
    const poll = (db.coordinatePolls || []).find(
      (candidate) => candidate.id === normalized.pollId && candidate.roomId === room.id,
    );
    if (!poll) return null;
    return {
      ...normalized,
      roomId: room.id,
      label: poll.title || normalized.label,
      pollId: poll.id,
      sourceId: poll.id,
      date: sourceDate(poll.rangeStart || poll.createdAt),
    };
  }

  if (normalized.type === "uploaded_file") {
    return normalized;
  }

  return null;
}

function enrichBuddySourcesForRoom(db, room, sources, userId) {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : [])
    .map((source) => enrichBuddySourceForRoom(db, room, source, userId))
    .filter(Boolean)
    .filter((source) => {
      const key = buddySourceIdentity(source);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function resourceDisplayName(resource) {
  return resource?.originalName || resource?.title || resource?.storageName || resource?.url || "";
}

function uniqueResourceNames(resources, limit = 30) {
  return [
    ...new Set(
      resources
        .map(resourceDisplayName)
        .map((name) => String(name || "").trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

/**
 * Adds lightweight file-name context to the final user turn before forwarding it
 * to Intelligrate. The chatbot service only accepts one manually uploaded file,
 * so multi-file comparisons are represented through the already-synced room
 * corpus instead of silently dropping every attachment after the first one.
 */
function withBuddyResourceContext(messageChain, { attachedResources = [], roomResources = [] }) {
  if (!messageChain.length) return messageChain;

  const attachedNames = uniqueResourceNames(attachedResources, 12);
  const roomNames = uniqueResourceNames(roomResources.filter(isChatbotDocument), 30);
  const contextLines = [];

  if (attachedNames.length) {
    contextLines.push(`Files attached to this message: ${attachedNames.join(", ")}.`);
  }

  if (attachedNames.length > 1) {
    contextLines.push(
      "When the user asks about the attached files together, compare all listed attachments by searching the room corpus for their synced contents.",
    );
  }

  if (roomNames.length) {
    contextLines.push(`Available room resource filenames: ${roomNames.join(", ")}.`);
  }

  if (!contextLines.length) return messageChain;

  const nextChain = [...messageChain];
  const latestIndex = nextChain.length - 1;
  const latestMessage = nextChain[latestIndex];
  nextChain[latestIndex] = {
    ...latestMessage,
    content: `${latestMessage.content}\n\n[Room resource context]\n${contextLines
      .map((line) => `- ${line}`)
      .join("\n")}`.slice(0, 6000),
  };

  return nextChain;
}

/**
 * Embeds supported Domain context in Intelligrate's corpus.
 * A fingerprint cache avoids repeated embedding when room context is unchanged.
 */
async function syncRoomResourcesWithChatbot(db, room, options: any = {}) {
  const force = Boolean(options.force);
  const corpus = buildDomainCorpusPayload(db, room);
  const fingerprint = domainCorpusFingerprint(corpus);
  const cachedFingerprint = room.resourceSyncFingerprint || roomCorpusSyncCache.get(room.id);

  if (!force && cachedFingerprint === fingerprint) {
    roomCorpusSyncCache.set(room.id, fingerprint);
    return {
      result: true,
      success: [
        ...corpus.files.map((file) => file.file_name || file.url),
        ...corpus.documents.map((document) => document.title),
      ],
      failed: [],
      totalChunks: 0,
      cached: true,
      message: "Domain corpus is already synced.",
    };
  }

  if (!corpus.files.length && !corpus.documents.length) {
    await clearChatbotCorpus(room.id);
    roomCorpusSyncCache.set(room.id, fingerprint);
    room.resourceSyncFingerprint = fingerprint;
    room.resourceSyncUpdatedAt = new Date().toISOString();
    await writeDb(db);
    return {
      result: true,
      success: [],
      failed: [],
      totalChunks: 0,
      message: "No supported Domain context is available to sync.",
    };
  }

  console.info(
    `[buddy] Syncing Domain corpus for room ${room.id}: ${corpus.files.length} file(s), ${corpus.documents.length} record(s)`,
  );
  const payload = await callChatbotJson("/corpus/sync", corpus);

  if (payload.result) {
    roomCorpusSyncCache.set(room.id, fingerprint);
    room.resourceSyncFingerprint = fingerprint;
    room.resourceSyncUpdatedAt = new Date().toISOString();
    await writeDb(db);
  }

  return {
    result: Boolean(payload.result),
    success: payload.success || [],
    failed: payload.failed || [],
    totalChunks: Number(payload.total_chunks || 0),
  };
}

function createHttpError(status, message) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Validates an Intelligrate request and resolves attachment IDs into room-owned resources.
 * This keeps the chatbot service from seeing files outside the active room.
 */
function resolveBuddyMessagePayload(db, room, body) {
  const messageChain = normalizeBuddyMessageChain(body.messages);
  if (!messageChain.length || messageChain.at(-1).role !== "user") {
    throw createHttpError(400, "Send a question before asking Intelligrate.");
  }

  const attachmentIds = Array.isArray(body.attachmentResourceIds)
    ? body.attachmentResourceIds.map(String)
    : [];
  const attachedResources = attachmentIds
    .map((resourceId) =>
      db.resources.find(
        (resource) => resource.id === resourceId && resource.roomId === room.id,
      ),
    )
    .filter(Boolean);
  const directResources = attachedResources.filter(isChatbotFileResource);
  const roomResources = db.resources.filter((resource) => resource.roomId === room.id);

  if (attachedResources.length && !directResources.length) {
    throw createHttpError(
      400,
      "Intelligrate can currently read one PDF, TXT, DOCX, or PPTX attachment at a time.",
    );
  }

  // The chatbot service currently accepts one direct uploaded file. When a
  // message has multiple attachments, the files are already synced into the
  // room corpus, so the safest app-side path is to provide exact filenames and
  // let Intelligrate search the corpus instead of silently reading only one.
  const directResource = directResources.length === 1 ? directResources[0] : null;
  const enrichedMessageChain = withBuddyResourceContext(messageChain, {
    attachedResources,
    roomResources,
  });

  return {
    messageChain: enrichedMessageChain,
    directResource,
    attachedResources,
  };
}

function safeUploadPath(storageName) {
  const targetPath = path.resolve(uploadDir, storageName || "");
  const uploadRoot = path.resolve(uploadDir);

  if (!targetPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Invalid upload path.");
  }

  return targetPath;
}

function normalizeUploadStorageName(storageName = "") {
  return String(storageName || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

async function persistUploadBlobFromPath(storageName, filePath, metadata = {}) {
  if (!hasDatabaseUploadBlobStore()) return;

  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) return;

  const body = await fs.promises.readFile(filePath);
  await saveUploadBlob({
    storageName: normalizedStorageName,
    body,
    mimeType: metadata.mimeType || metadata.mimetype || "application/octet-stream",
    originalName: metadata.originalName || metadata.originalname || normalizedStorageName,
  });
}

async function readStoredUploadBlob(storageName) {
  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) return null;
  return readUploadBlob(normalizedStorageName);
}

async function readUploadFileBuffer(storageName) {
  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) return null;

  const filePath = safeUploadPath(normalizedStorageName);
  if (fs.existsSync(filePath)) {
    return fs.promises.readFile(filePath);
  }

  const blob = await readStoredUploadBlob(normalizedStorageName);
  return blob?.body || null;
}

async function uploadFileExists(storageName) {
  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) return false;
  if (fs.existsSync(safeUploadPath(normalizedStorageName))) return true;
  return Boolean(await readStoredUploadBlob(normalizedStorageName));
}

async function materializeUploadFile(storageName, metadata = {}) {
  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) return null;

  const filePath = safeUploadPath(normalizedStorageName);
  if (fs.existsSync(filePath)) return filePath;

  const blob = await readStoredUploadBlob(normalizedStorageName);
  if (!blob?.body) return null;

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, blob.body);
  if (metadata.mimeType || metadata.originalName) {
    await saveUploadBlob({
      storageName: normalizedStorageName,
      body: blob.body,
      mimeType: metadata.mimeType || blob.mimeType || "application/octet-stream",
      originalName: metadata.originalName || blob.originalName || normalizedStorageName,
    });
  }
  return filePath;
}

async function hashStoredUpload(storageName) {
  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) throw new Error("Invalid upload path.");

  const filePath = safeUploadPath(normalizedStorageName);
  if (fs.existsSync(filePath)) {
    return hashUploadedFile(filePath);
  }

  const blob = await readStoredUploadBlob(normalizedStorageName);
  if (!blob?.body) throw new Error("Resource file not found.");
  return hashBuffer(blob.body);
}

async function deleteStoredUploadFile(storageName) {
  const normalizedStorageName = normalizeUploadStorageName(storageName);
  if (!normalizedStorageName) return;

  fs.rmSync(safeUploadPath(normalizedStorageName), { force: true });
  await deleteUploadBlob(normalizedStorageName);
}

function canManageResource(room, resource, userId) {
  return Boolean(room && resource && (room.ownerId === userId || resource.uploaderId === userId));
}

function emitResourceEvent(db, roomId, event, resource) {
  io.to(`room:${roomId}`).emit(event, {
    roomId,
    resource: resource ? resourceDto(db, resource) : null,
  });
}

async function purgeExpiredDeletedResources(db) {
  const now = Date.now();
  const beforeCount = db.resources.length;
  const storageNamesToDelete = [];

  db.resources = db.resources.filter((resource) => {
    if (!resource.deletedAt) return true;
    const deletedAtMs = Date.parse(resource.deletedAt);
    if (!Number.isFinite(deletedAtMs)) return true;

    const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
    const retentionDays = Math.min(
      365,
      Math.max(1, Number(room?.resourceDeleteRetentionDays || 30) || 30),
    );
    if (now - deletedAtMs < retentionDays * 24 * 60 * 60 * 1000) return true;

    if (resource.type === "file") {
      if (resource.storageName) storageNamesToDelete.push(resource.storageName);
      if (resource.pdfPath) storageNamesToDelete.push(resource.pdfPath);
    }
    return false;
  });

  await Promise.all(storageNamesToDelete.map((storageName) => deleteStoredUploadFile(storageName)));

  return db.resources.length !== beforeCount;
}

function sanitizeResourceMetadataPatch(value) {
  const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const patch: any = {};

  if (metadata.resourceType != null || metadata.type != null) {
    const resourceType = String(metadata.resourceType || metadata.type || "Reference").trim().slice(0, 60);
    patch.resourceType = resourceType || "Reference";
    patch.type = patch.resourceType;
  }
  if (metadata.topic != null) patch.topic = String(metadata.topic || "").trim().slice(0, 120);
  if (Array.isArray(metadata.tags)) {
    patch.tags = metadata.tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  return patch;
}

/**
 * Backfills hashes/metadata for older file resources before dedupe checks run.
 * This keeps existing rooms compatible without requiring a one-off migration script.
 */
async function ensureRoomResourceFileMetadata(db, room) {
  let changed = false;

  for (const resource of db.resources) {
    if (resource.roomId !== room.id || resource.type !== "file" || !resource.storageName) continue;

    if (!resource.contentHash) {
      try {
        resource.contentHash = await hashStoredUpload(resource.storageName);
        changed = true;
      } catch (error) {
        console.warn(`[resources] Could not hash ${resource.storageName}: ${error.message}`);
      }
    }

    if (!resource.metadata || !Object.keys(resource.metadata).length) {
      resource.metadata = buildResourceMetadata({
        room,
        title: resource.originalName || resource.title || resource.storageName,
        sourceType: "file",
        mimeType: resource.mimeType,
        size: resource.size,
        url: resource.url,
      });
      changed = true;
    }
  }

  if (changed) {
    await writeDb(db);
  }
}

function chatbotUrl(pathname) {
  return new URL(pathname, `${chatbotBaseUrl}/`);
}

function chatbotWarmupUrl(pathname) {
  return new URL(pathname, `${chatbotWarmupBaseUrl}/`);
}

async function readChatbotPayload(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg || item.message || String(item)).join(" ")
      : payload.detail;
    throw createHttpError(
      response.status,
      detail || payload.message || "Intelligrate is not available right now.",
    );
  }

  return payload;
}

const llmProviderCatalogCacheTtlMs = 5 * 60 * 1000;
const llmProviderCatalogCache = {
  fetchedAt: 0,
  providers: [],
};

/**
 * Reads the LiteLLM provider/model catalog from the chatbot service. A short
 * cache keeps settings responsive without turning the Node app into the source
 * of truth for provider variants.
 */
async function fetchLlmProviderCatalog({ allowStale = false } = {}) {
  const now = Date.now();
  if (
    llmProviderCatalogCache.providers.length &&
    now - llmProviderCatalogCache.fetchedAt < llmProviderCatalogCacheTtlMs
  ) {
    return {
      available: true,
      error: "",
      providers: llmProviderCatalogCache.providers,
      stale: false,
    };
  }

  try {
    const response = await fetch(chatbotUrl("/llm/providers"), {
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await readChatbotPayload(response);
    const providers = normalizeLlmProviderCatalog(payload);
    if (!providers.length) {
      throw new Error("LiteLLM returned an empty provider catalog.");
    }

    llmProviderCatalogCache.fetchedAt = now;
    llmProviderCatalogCache.providers = providers;
    return {
      available: true,
      error: "",
      providers,
      stale: false,
    };
  } catch (error) {
    const message = error?.message || "Unable to load LiteLLM provider catalog.";
    console.warn(`[llm-keys] Provider catalog unavailable: ${message}`);
    if (allowStale && llmProviderCatalogCache.providers.length) {
      return {
        available: false,
        error: message,
        providers: llmProviderCatalogCache.providers,
        stale: true,
      };
    }

    return {
      available: false,
      error: message,
      providers: [],
      stale: false,
    };
  }
}

/** Requires the service catalog for writes and BYOK sends so provider/model choices are validated. */
async function requireLlmProviderCatalog() {
  const catalog = await fetchLlmProviderCatalog({ allowStale: true });
  if (catalog.providers.length) return catalog;

  throw createHttpError(
    503,
    "Unable to load LiteLLM providers right now. Please try again once the Intelligrate service is ready.",
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function warmChatbotOnStartup() {
  const providerStatus = getBuddyProviderStatus();
  if (!providerStatus.available) {
    console.info("[buddy] Skipping chatbot warm-up because no LLM provider is configured.");
    return;
  }

  for (let attempt = 1; attempt <= chatbotWarmupAttempts; attempt += 1) {
    try {
      const startedAt = Date.now();
      console.info(
        `[buddy] Warming chatbot service (${attempt}/${chatbotWarmupAttempts})...`,
      );

      const response = await fetch(chatbotWarmupUrl("/health"), {
        signal: AbortSignal.timeout(chatbotWarmupTimeoutMs),
      });
      await readChatbotPayload(response);

      console.info(`[buddy] Chatbot warm-up succeeded in ${Date.now() - startedAt}ms.`);
      return;
    } catch (error) {
      console.warn(
        `[buddy] Chatbot warm-up failed (${attempt}/${chatbotWarmupAttempts}): ${error.message}`,
      );

      if (attempt < chatbotWarmupAttempts) {
        await wait(chatbotWarmupRetryDelayMs);
      }
    }
  }
}

async function readChatbotHealthWithRetry(timeoutMs = chatbotHealthTimeoutMs) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const remainingMs = Math.max(1_000, timeoutMs - (Date.now() - startedAt));

    try {
      console.info(
        `[buddy] Checking chatbot health (${attempt}, ${Math.ceil(remainingMs / 1000)}s left)...`,
      );

      const response = await fetch(chatbotWarmupUrl("/health"), {
        signal: AbortSignal.timeout(remainingMs),
      });
      return await readChatbotPayload(response);
    } catch (error) {
      lastError = error;

      if (Date.now() - startedAt >= timeoutMs) break;
      await wait(Math.min(chatbotWarmupRetryDelayMs, timeoutMs - (Date.now() - startedAt)));
    }
  }

  throw lastError || new Error("Intelligrate is not available right now.");
}

async function callChatbotJson(pathname, body, timeoutMs = 180_000) {
  const response = await fetch(chatbotUrl(pathname), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  return readChatbotPayload(response);
}

function cleanGeneratedBuddyTitle(value, fallback) {
  const cleaned = String(value || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback || "New Chat").slice(0, 60);
}

async function generateBuddyTitle(message) {
  const prompt = [
    "Generate a concise study chat title for this first user message.",
    "Return only the title, with no quotes, no markdown, and no explanation.",
    "Keep it under 6 words.",
    "",
    `Message: ${String(message || "").slice(0, 1200)}`,
  ].join("\n");
  const url = chatbotUrl("/predict");
  url.searchParams.set(
    "message_chain",
    JSON.stringify([{ role: "user", content: prompt }]),
  );

  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await readChatbotPayload(response);

  return cleanGeneratedBuddyTitle(payload.answer, "New Chat");
}

async function clearChatbotCorpus(roomId) {
  const url = chatbotUrl("/corpus");
  url.searchParams.set("room_id", roomId);

  const response = await fetch(url, {
    method: "DELETE",
    signal: AbortSignal.timeout(15_000),
  });

  return readChatbotPayload(response);
}

async function createChatbotPredictRequest(pathname, { messageChain, roomId, resource, llmModel = "", llmApiKey = "" }) {
  const url = chatbotUrl(pathname);
  url.searchParams.set("message_chain", JSON.stringify(messageChain));
  url.searchParams.set("room_id", roomId);
  if (llmModel) url.searchParams.set("llm_model", llmModel);

  const headers: Record<string, string> = {};
  if (llmApiKey) {
    // Keep BYOK secrets out of URLs so access logs never echo a member's provider key.
    headers["X-Diffriendtiate-Llm-Api-Key"] = llmApiKey;
  }

  const init: RequestInit = {
    method: "POST",
    signal: AbortSignal.timeout(240_000),
  };
  if (Object.keys(headers).length > 0) {
    init.headers = headers;
  }

  if (resource) {
    const fileBytes = await readUploadFileBuffer(resource.storageName);
    if (!fileBytes) {
      throw createHttpError(404, "Resource file not found.");
    }
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([fileBytes], {
        type: resource.mimeType || "application/octet-stream",
      }),
      resource.originalName || resource.title || resource.storageName,
    );

    init.body = formData;
  }

  return { url, init };
}

/**
 * Non-streaming Intelligrate request path retained for simpler API callers and debugging.
 */
async function askChatbot({ messageChain, roomId, resource, llmModel = "", llmApiKey = "" }) {
  const { url, init } = await createChatbotPredictRequest("/predict", {
    messageChain,
    roomId,
    resource,
    llmModel,
    llmApiKey,
  });
  const response = await fetch(url, init);
  return readChatbotPayload(response);
}

/**
 * Streaming Intelligrate request path used by the web UI for token-by-token responses.
 */
async function streamChatbot({ messageChain, roomId, resource, llmModel = "", llmApiKey = "" }) {
  const { url, init } = await createChatbotPredictRequest("/predict/stream", {
    messageChain,
    roomId,
    resource,
    llmModel,
    llmApiKey,
  });
  const response = await fetch(url, init);

  if (!response.ok) {
    await readChatbotPayload(response);
  }

  if (!response.body) {
    throw new Error("Intelligrate did not return a stream.");
  }

  return response;
}

/**
 * Shared room lookup helper for routes that need consistent 404 handling.
 */
function findRoomOr404(db, roomId, res) {
  const room = db.rooms.find((candidate) => candidate.id === roomId);
  if (!room) {
    res.status(404).json({ message: "Room not found." });
    return null;
  }
  return room;
}

function assertRoomMember(db, roomId, userId, res) {
  const room = findRoomOr404(db, roomId, res);
  if (!room) return null;

  if (!isMember(room, userId)) {
    res.status(403).json({ message: "Join the room to access this area." });
    return null;
  }

  return room;
}

function assertRoomOwner(db, roomId, userId, res) {
  const room = findRoomOr404(db, roomId, res);
  if (!room) return null;

  if (room.ownerId !== userId) {
    res.status(403).json({ message: "Only the room owner can manage this setting." });
    return null;
  }

  return room;
}

function normalizeSessionKind(value) {
  return ["meeting", "event", "deadline"].includes(value) ? value : "meeting";
}

function normalizeSessionVisibility(value) {
  return value === "private" ? "private" : "room";
}

function normalizeSessionColor(value) {
  return ["rose", "gold", "green", "iris", "foam"].includes(value) ? value : "";
}

function isSessionVisibleToUser(session, userId) {
  return session.visibility !== "private" || session.createdBy === userId;
}

function normalizeOptionalIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeAvailabilitySlots(value) {
  return (Array.isArray(value) ? value : [])
    .map((slot) => {
      const startAt = normalizeOptionalIso(slot?.startAt);
      const endAt = normalizeOptionalIso(slot?.endAt);
      if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return null;

      return {
        startAt,
        endAt,
        status: slot?.status === "ifNeeded" ? "ifNeeded" : "available",
      };
    })
    .filter(Boolean)
    .slice(0, 1_500);
}

function normalizeMinuteOfDay(value, fallback) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return fallback;
  return Math.min(24 * 60, Math.max(0, minutes));
}

function datePartsInTimeZone(value, timeZone = "Asia/Singapore") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateKey(value, timeZone = "Asia/Singapore") {
  const parts = datePartsInTimeZone(value, timeZone);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesOfDay(value, timeZone = "Asia/Singapore") {
  const parts = datePartsInTimeZone(value, timeZone);
  if (!parts) return 0;
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function normalizeSelectedDates(value, rangeStart, rangeEnd) {
  const startKey = localDateKey(rangeStart);
  const endKey = localDateKey(rangeEnd);
  const dates = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      dates
        .map((date) => String(date || "").trim())
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .filter((date) => date >= startKey && date <= endKey),
    ),
  ).slice(0, 180);
}

function availabilitySlotAllowedForPoll(slot, poll) {
  const startMs = Date.parse(slot.startAt);
  const endMs = Date.parse(slot.endAt);
  if (startMs < Date.parse(poll.rangeStart) || endMs > Date.parse(poll.rangeEnd)) return false;

  const timeZone = poll.timezone || "Asia/Singapore";
  const selectedDates = Array.isArray(poll.selectedDates) ? poll.selectedDates : [];
  if (selectedDates.length && !selectedDates.includes(localDateKey(slot.startAt, timeZone))) return false;

  const startMinutes = minutesOfDay(slot.startAt, timeZone);
  const endMinutes = minutesOfDay(slot.endAt, timeZone);
  const dayStart = normalizeMinuteOfDay(poll.dayStartMinutes, 9 * 60);
  const dayEnd = normalizeMinuteOfDay(poll.dayEndMinutes, 17 * 60);
  return startMinutes >= dayStart && endMinutes <= dayEnd;
}

function normalizeCanvasHost(value) {
  const host = String(value || "canvas.nus.edu.sg")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) {
    const error = new Error("Enter a valid Canvas host.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }

  return host;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

async function fetchCanvasJson(host, accessToken, pathname, params = {}) {
  const url = new URL(`https://${host}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18_000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? "Canvas rejected that access token."
          : payload?.errors?.[0]?.message || payload?.message || "Canvas did not return a successful response.";
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status === 401 || response.status === 403 ? 401 : 502;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCanvasJsonPages(host, accessToken, pathname, params = {}) {
  const pages = [];
  let nextUrl = new URL(`https://${host}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") nextUrl.searchParams.set(key, String(value));
  });

  for (let page = 0; page < 30 && nextUrl; page += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18_000);

    try {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.message || "Canvas did not return a successful response.") as Error & {
          status?: number;
        };
        error.status = response.status === 401 || response.status === 403 ? 401 : 502;
        throw error;
      }

      if (Array.isArray(payload)) pages.push(...payload);
      else if (payload) pages.push(payload);

      const linkHeader = response.headers.get("link") || "";
      const nextMatch = linkHeader
        .split(",")
        .map((part) => part.trim())
        .find((part) => /rel="?next"?/i.test(part))
        ?.match(/<([^>]+)>/);
      nextUrl = nextMatch ? new URL(nextMatch[1]) : null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return pages;
}

function canvasFolderName(folder) {
  return String(folder?.name || folder?.full_name || "Folder")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Folder";
}

async function fetchCanvasCourseFiles(host, accessToken, courseId) {
  const rootFolder = await fetchCanvasJson(
    host,
    accessToken,
    `/api/v1/courses/${encodeURIComponent(courseId)}/folders/root`,
  );
  const files = [];

  async function visitFolder(folder, parts) {
    const folderId = String(folder?.id || "");
    if (!folderId) return;

    const [folderFiles, childFolders] = await Promise.all([
      fetchCanvasJsonPages(host, accessToken, `/api/v1/folders/${encodeURIComponent(folderId)}/files`, {
        per_page: 100,
      }),
      fetchCanvasJsonPages(host, accessToken, `/api/v1/folders/${encodeURIComponent(folderId)}/folders`, {
        per_page: 100,
      }),
    ]);

    for (const file of folderFiles) {
      const title = String(file?.display_name || file?.filename || file?.name || "Canvas File")
        .trim()
        .slice(0, 180);
      const url = String(file?.url || file?.html_url || "").trim();
      if (!title || !url) continue;
      files.push({
        id: String(file?.id || file?.uuid || `${parts.join("/")}:${title}`),
        title,
        folder: normalizeFolder(["Canvas", ...parts].join("/")),
        url,
        mimeType: String(file?.["content-type"] || file?.content_type || ""),
        size: Number(file?.size) || 0,
        updatedAt: normalizeOptionalIso(file?.updated_at || file?.modified_at) || new Date().toISOString(),
      });
    }

    for (const childFolder of childFolders) {
      await visitFolder(childFolder, [...parts, canvasFolderName(childFolder)]);
    }
  }

  await visitFolder(rootFolder, []);
  return files;
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "");
    callback(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: RESOURCE_FILE_SIZE_LIMIT,
  },
});

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});
const activeSocketByUser = new Map();

function registerSingleActiveUserSocket(socket) {
  const userId = socket.user?.id;
  if (!userId) return;

  const previousSocketId = activeSocketByUser.get(userId);
  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) {
      previousSocket.emit("session:replaced", {
        message: "This account is now active in another tab or window.",
      });
      previousSocket.disconnect(true);
    }
  }

  activeSocketByUser.set(userId, socket.id);
}

function clearSingleActiveUserSocket(socket) {
  const userId = socket.user?.id;
  if (!userId) return;

  if (activeSocketByUser.get(userId) === socket.id) {
    activeSocketByUser.delete(userId);
  }
}

function refreshLiveUserProfile(user) {
  const profile = publicUser(user);

  io.sockets.sockets.forEach((socket) => {
    if (socket.user?.id === user.id) {
      socket.user = { ...socket.user, ...user };
    }
  });

  roomActivityByRoom.forEach((activityByUser) => {
    const activity = activityByUser.get(user.id);
    if (activity) activityByUser.set(user.id, { ...activity, user: profile });
  });

  spacePresenceByRoom.forEach((presenceBySocket) => {
    presenceBySocket.forEach((presence, presenceKey) => {
      if (presence.userId === user.id) {
        presenceBySocket.set(presenceKey, { ...presence, user: profile });
      }
    });
  });

  meetingPresenceByRoom.forEach((presenceByArea) => {
    presenceByArea.forEach((presenceByUser) => {
      const presence = presenceByUser.get(user.id);
      if (presence) presenceByUser.set(user.id, { ...presence, user: profile });
    });
  });

  return profile;
}

async function emitRoomUpdated(db, room) {
  const roomKey = `room:${room.id}`;
  io.sockets.sockets.forEach((socket) => {
    if (socket.rooms.has(roomKey)) {
      socket.emit("room:updated", roomDto(db, room, socket.user?.id));
    }
  });
}

function emitCoordinateUpdated(db, room) {
  io.to(`room:${room.id}`).emit("coordinate:updated", {
    roomId: room.id,
    coordinate: coordinateDto(db, room),
  });
}

function emitSessionsUpdated(db, room) {
  const roomKey = `room:${room.id}`;
  io.sockets.sockets.forEach((socket) => {
    if (!socket.rooms.has(roomKey)) return;

    socket.emit("sessions:updated", {
      roomId: room.id,
      sessions: db.sessions
        .filter((session) => session.roomId === room.id)
        .filter((session) => isSessionVisibleToUser(session, socket.user?.id))
        .map((session) => sessionDto(db, session))
        .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    });
  });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(uploadDir));
app.get(/^\/uploads\/(.+)$/, async (req, res, next) => {
  let storageName = req.path.replace(/^\/uploads\//, "");
  try {
    storageName = decodeURIComponent(storageName);
  } catch {
    // Keep the raw path; the blob lookup will miss safely if it is invalid.
  }

  const blob = await readStoredUploadBlob(storageName);
  if (!blob?.body) return next();

  const filename =
    String(blob.originalName || path.basename(storageName))
      .replace(/[\r\n"]/g, "")
      .trim() || "document";
  res.type(blob.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  return res.send(blob.body);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Diffriendtiate API", storage: storageMode() });
});

function redirectToAuthError(req, res, message) {
  res.redirect(buildClientAuthRedirectUrl(req, { error: message }));
}

app.get("/api/auth/oauth/:provider", (req, res) => {
  const provider = normalizeOAuthProvider(req.params.provider);
  if (!provider) {
    return res.status(404).json({ message: "OAuth provider not found." });
  }

  const config = getOAuthProviderConfig(provider);
  if (!isOAuthProviderConfigured(config)) {
    return redirectToAuthError(req, res, `${config.label} sign-in is not configured yet.`);
  }

  const redirectUri = buildOAuthCallbackUrl(req, provider);
  const state = signOAuthState(provider, jwtSecret);
  res.redirect(buildOAuthAuthorizationUrl(config, redirectUri, state));
});

app.get("/api/auth/oauth/:provider/callback", async (req, res) => {
  const provider = normalizeOAuthProvider(req.params.provider);
  if (!provider) {
    return res.status(404).json({ message: "OAuth provider not found." });
  }

  const config = getOAuthProviderConfig(provider);
  const providerError = String(req.query.error_description || req.query.error || "").trim();
  if (providerError) {
    return redirectToAuthError(req, res, `${config.label} sign-in was cancelled or denied.`);
  }

  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  if (!code || !state) {
    return redirectToAuthError(req, res, `${config.label} sign-in did not return the required credentials.`);
  }

  try {
    if (!isOAuthProviderConfigured(config)) {
      throw new Error(`${config.label} sign-in is not configured yet.`);
    }

    if (!verifyOAuthState(state, provider, jwtSecret)) {
      throw new Error("OAuth state could not be verified.");
    }

    const redirectUri = buildOAuthCallbackUrl(req, provider);
    const tokenPayload = await exchangeOAuthCode(config, code, redirectUri);
    const profile = await fetchOAuthProfile(provider, tokenPayload);
    const db = await readDb();
    const user = await upsertOAuthUser(db, profile);
    await writeDb(db);

    res.redirect(
      buildClientAuthRedirectUrl(req, {
        token: signToken(user),
      }),
    );
  } catch (error) {
    const authError = error as Error;
    console.warn(`[auth] ${config.label} OAuth failed: ${authError.message}`);
    const isUserSafeMessage =
      /not configured|verified email|NUS school|organization email|state could not be verified/i.test(
        authError.message,
      );
    redirectToAuthError(
      req,
      res,
      isUserSafeMessage ? authError.message : `${config.label} sign-in could not be completed.`,
    );
  }
});

app.post("/api/auth/supabase/session", async (req, res) => {
  if (!isSupabaseAuthConfigured()) {
    return res.status(503).json({ message: "Supabase authentication is not configured yet." });
  }

  const accessToken = String(req.body.accessToken || "").trim();
  const name = String(req.body.name || "").trim();
  if (!accessToken) {
    return res.status(400).json({ message: "Supabase session is missing." });
  }

  try {
    const user = await getUserBySupabaseAccessToken(accessToken, name);
    if (!user) {
      return res.status(401).json({ message: "Supabase session could not be verified." });
    }

    res.json({
      token: accessToken,
      user: publicUser(user),
    });
  } catch (error) {
    const authError = error as Error;
    console.warn(`[auth] Supabase session failed: ${authError.message}`);
    res.status(401).json({ message: "Supabase session could not be verified." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const db = await readDb();
  const name = String(req.body.name || "").trim();
  const email = toEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!name || !email || password.length < 6) {
    return res.status(400).json({
      message: "Name, email, and a password of at least 6 characters are required.",
    });
  }

  if (db.users.some((user) => user.email === email)) {
    return res.status(409).json({ message: "An account with this email already exists." });
  }

  if (!assertAuthActionDeliveryConfigured(res)) return;

  const now = new Date().toISOString();
  const user = {
    id: createId("usr"),
    name,
    email,
    avatarPreset: null,
    avatarUrl: "",
    authProviders: {},
    emailVerified: false,
    emailVerification: null,
    passwordReset: null,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: now,
  };
  markPasswordConfigured(user);
  const verificationToken = createEmailVerification(user);
  const emailResult = await sendEmailVerificationEmail(req, user, verificationToken);

  db.users.push(user);
  await writeDb(db);

  res.status(201).json({
    ...emailVerificationInstructionsPayload(req, verificationToken, emailResult.sent),
    user: publicUser(user),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const db = await readDb();
  const email = toEmail(req.body.email);
  const password = String(req.body.password || "");
  const user = db.users.find((candidate) => candidate.email === email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  if (user.emailVerified === false) {
    if (!assertAuthActionDeliveryConfigured(res)) return;
    const retryAfterSeconds = emailVerificationRetryAfterSeconds(user);
    if (retryAfterSeconds > 0) {
      applyEmailVerificationRetryAfter(res, retryAfterSeconds);
      return res.status(403).json({
        ...emailVerificationInstructionsPayload(req),
        email: user.email,
        message: `Check your email for a verification link before logging in. You can request another one in ${retryAfterSeconds} seconds.`,
        retryAfterSeconds,
      });
    }

    const verificationToken = createEmailVerification(user);
    const emailResult = await sendEmailVerificationEmail(req, user, verificationToken);
    await writeDb(db);
    return res.status(403).json({
      ...emailVerificationInstructionsPayload(req, verificationToken, emailResult.sent),
      email: user.email,
    });
  }

  res.json({
    token: signToken(user),
    user: publicUser(user),
  });
});

app.post("/api/auth/email-verification/resend", async (req, res) => {
  const db = await readDb();
  const email = toEmail(req.body.email);

  if (!email) {
    return res.status(400).json({ message: "Email Address is required." });
  }

  const user = db.users.find((candidate) => candidate.email === email);
  if (!user) {
    return res.json(emailVerificationInstructionsPayload(req));
  }

  if (!assertAuthActionDeliveryConfigured(res)) return;

  if (user.emailVerified !== false) {
    return res.json({
      emailVerificationRequired: false,
      message: "Email address is already verified. You can log in.",
    });
  }

  const retryAfterSeconds = emailVerificationRetryAfterSeconds(user);
  if (retryAfterSeconds > 0) {
    applyEmailVerificationRetryAfter(res, retryAfterSeconds);
    return res.status(429).json({
      ...emailVerificationInstructionsPayload(req),
      email: user.email,
      message: `Please wait ${retryAfterSeconds} seconds before requesting another verification email.`,
      retryAfterSeconds,
    });
  }

  const verificationToken = createEmailVerification(user);
  const emailResult = await sendEmailVerificationEmail(req, user, verificationToken);
  await writeDb(db);

  res.json({
    ...emailVerificationInstructionsPayload(req, verificationToken, emailResult.sent),
    email: user.email,
  });
});

app.post("/api/auth/email-verification/confirm", async (req, res) => {
  const db = await readDb();
  const token = String(req.body.token || "").trim();

  if (!token) {
    return res.status(400).json({ message: "Verification link is missing." });
  }

  const tokenHash = hashAuthActionToken(token);
  const user = db.users.find((candidate) => {
    const verification = candidate.emailVerification;
    if (!verification || typeof verification !== "object") return false;
    if (verification.tokenHash !== tokenHash) return false;
    return Number.isFinite(Date.parse(verification.expiresAt)) && Date.parse(verification.expiresAt) > Date.now();
  });

  if (!user) {
    return res.status(400).json({ message: "Verification link is invalid or expired." });
  }

  user.emailVerified = true;
  user.emailVerification = null;
  await writeDb(db);

  res.json({
    message: "Email verified. Welcome to Diffriendtiate.",
    token: signToken(user),
    user: publicUser(user),
  });
});

app.post("/api/auth/password-reset/request", async (req, res) => {
  const db = await readDb();
  const email = toEmail(req.body.email);

  if (!email) {
    return res.status(400).json({ message: "Email Address is required." });
  }

  const user = db.users.find((candidate) => candidate.email === email);
  if (!user) {
    return res.json(passwordResetInstructionsPayload(req));
  }

  if (!assertAuthActionDeliveryConfigured(res)) return;

  const token = createAuthActionToken();
  const now = new Date();
  user.passwordReset = {
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + passwordResetTokenTtlMs).toISOString(),
    tokenHash: hashAuthActionToken(token),
  };

  const emailResult = await sendPasswordResetEmail(req, user, token);
  await writeDb(db);
  res.json(passwordResetInstructionsPayload(req, token, emailResult.sent));
});

app.post("/api/auth/password-reset/confirm", async (req, res) => {
  const db = await readDb();
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "");

  if (!token || password.length < 6) {
    return res.status(400).json({
      message: "A valid reset link and a password of at least 6 characters are required.",
    });
  }

  const tokenHash = hashAuthActionToken(token);
  const user = db.users.find((candidate) => {
    const reset = candidate.passwordReset;
    if (!reset || typeof reset !== "object") return false;
    if (reset.tokenHash !== tokenHash) return false;
    return Number.isFinite(Date.parse(reset.expiresAt)) && Date.parse(reset.expiresAt) > Date.now();
  });

  if (!user) {
    return res.status(400).json({ message: "Reset link is invalid or expired." });
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  markPasswordConfigured(user);
  user.passwordReset = null;
  await writeDb(db);

  res.json({ message: "Password updated. You can log in now." });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/auth/me", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const name = String(req.body.name || "").trim();
  if (!name || name.length > 80) {
    return res.status(400).json({ message: "Username must be 1 to 80 characters." });
  }

  try {
    user.name = name;
    user.avatarUrl = normalizeAvatarUrl(req.body.avatarUrl);
    user.avatarPreset = normalizeAvatarPreset(req.body.avatarPreset);
    await writeDb(db);

    const profile = refreshLiveUserProfile(user);
    db.rooms
      .filter((room) => isMember(room, user.id))
      .forEach((room) => {
        io.to(`room:${room.id}`).emit("user:profile-updated", {
          roomId: room.id,
          user: profile,
        });
      });

    res.json({ user: profile });
  } catch (error) {
    const profileError = error as Error & { status?: number };
    res
      .status(profileError.status || 400)
      .json({ message: profileError.message || "Unable to update profile." });
  }
});

app.patch("/api/auth/account", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const name = String(req.body.name || "").trim();
  const email = toEmail(req.body.email);

  if (!name || name.length > 80) {
    return res.status(400).json({ message: "Username must be 1 to 80 characters." });
  }

  if (email && email !== toEmail(user.email)) {
    return res.status(501).json({
      message: "Email changes require verification and are not available yet.",
    });
  }

  user.name = name;

  await writeDb(db);
  const profile = refreshLiveUserProfile(user);
  db.rooms
    .filter((room) => isMember(room, user.id))
    .forEach((room) => {
      io.to(`room:${room.id}`).emit("user:profile-updated", {
        roomId: room.id,
        user: profile,
      });
    });

  res.json({ user: profile });
});

app.patch("/api/auth/password", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || req.body.password || "");

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  const alreadyHadPassword = hasConfiguredPassword(user);
  if (alreadyHadPassword) {
    const currentPasswordMatches =
      currentPassword && (await bcrypt.compare(currentPassword, user.passwordHash));
    if (!currentPasswordMatches) {
      return res.status(403).json({ message: "Current password is incorrect." });
    }
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.passwordReset = null;
  markPasswordConfigured(user);
  await writeDb(db);

  res.json({
    message: alreadyHadPassword ? "Password updated." : "Password set.",
    user: publicUser(user),
  });
});

app.get("/api/auth/llm-api-keys", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const catalog = await fetchLlmProviderCatalog({ allowStale: true });
  res.json({
    encryptionAvailable: canEncryptLlmApiKeys(),
    providerCatalogAvailable: catalog.available,
    providerCatalogError: catalog.available ? "" : catalog.error,
    providerCatalogStale: catalog.stale,
    providers: catalog.providers,
    keys: publicLlmApiKeysDto(user.llmApiKeys, catalog.providers),
  });
});

app.post("/api/auth/llm-api-keys", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  try {
    const catalog = await requireLlmProviderCatalog();
    const provider = getLlmProvider(catalog.providers, req.body.providerId);
    if (!provider) {
      return res.status(400).json({ message: "Choose a supported LLM provider." });
    }

    const rawApiKey = String(req.body.apiKey || "").trim();
    const apiKey = rawApiKey ? normalizeLlmApiSecret(rawApiKey) : "";
    const keyId = String(req.body.id || req.body.keyId || "").trim();
    const reuseKeyId = String(req.body.reuseKeyId || "").trim();
    const now = new Date().toISOString();
    const keys = normalizeStoredLlmApiKeys(user.llmApiKeys);
    const existingIndex = keyId ? keys.findIndex((record) => record.id === keyId) : -1;
    const existingRecord = existingIndex >= 0 ? keys[existingIndex] : null;
    const reusedCredentialRecord = !existingRecord && reuseKeyId
      ? keys.find((record) => record.id === reuseKeyId && record.providerId === provider.id)
      : null;

    if (!existingRecord && keys.length >= LLM_KEY_LIMIT_PER_USER) {
      return res.status(400).json({
        message: `You can save up to ${LLM_KEY_LIMIT_PER_USER} LLM API keys.`,
      });
    }
    if (reuseKeyId && !reusedCredentialRecord) {
      return res.status(400).json({ message: "Choose a saved credential for this provider." });
    }

    const model = normalizeLlmModel(req.body.model, provider);
    const duplicateModelRecord = keys.find(
      (record) =>
        record.id !== (existingRecord?.id || "") &&
        record.providerId === provider.id &&
        record.model === model,
    );
    if (duplicateModelRecord) {
      return res.status(409).json({ message: "This model is already saved for this provider." });
    }

    const nextRecord = {
      ...(existingRecord || {
        id: createId("llmkey"),
        createdAt: now,
      }),
      providerId: provider.id,
      providerName: provider.providerName,
      label: normalizeLlmLabel(req.body.label, provider.defaultLabel),
      model,
      updatedAt: now,
    };

    if (apiKey) {
      const keyFingerprint = hashLlmApiKeySecret(apiKey);
      const duplicateRecord = keys.find(
        (record) =>
          record.id !== nextRecord.id &&
          record.providerId === provider.id &&
          record.model === nextRecord.model &&
          record.keyFingerprint === keyFingerprint,
      );
      if (duplicateRecord) {
        return res.status(409).json({ message: "This provider/model key is already saved." });
      }

      nextRecord.encryptedApiKey = encryptLlmApiKey(apiKey);
      nextRecord.keyFingerprint = keyFingerprint;
      nextRecord.keyPreview = previewLlmApiKey(apiKey);
    } else if (reusedCredentialRecord) {
      nextRecord.encryptedApiKey = reusedCredentialRecord.encryptedApiKey;
      nextRecord.keyFingerprint = reusedCredentialRecord.keyFingerprint;
      nextRecord.keyPreview = reusedCredentialRecord.keyPreview;
    } else if (!existingRecord?.encryptedApiKey) {
      return res.status(400).json({ message: "Enter the API key for this provider." });
    }

    if (existingIndex >= 0) keys[existingIndex] = nextRecord;
    else keys.unshift(nextRecord);
    user.llmApiKeys = normalizeStoredLlmApiKeys(keys);

    await writeDb(db);
    console.info(`[llm-keys] Saved ${provider.id} key metadata for user ${user.id}.`);

    res.status(existingRecord ? 200 : 201).json({
      key: publicLlmApiKeysDto([nextRecord], catalog.providers)[0],
      keys: publicLlmApiKeysDto(user.llmApiKeys, catalog.providers),
    });
  } catch (error) {
    const llmKeyError = error as Error & { status?: number };
    console.warn(`[llm-keys] Save failed for user ${req.user.id}: ${llmKeyError.message}`);
    res.status(llmKeyError.status || 400).json({
      message: llmKeyError.message || "Unable to save this LLM API key.",
    });
  }
});

app.delete("/api/auth/llm-api-keys/:keyId", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const keyId = String(req.params.keyId || "").trim();
  const keys = normalizeStoredLlmApiKeys(user.llmApiKeys);
  const nextKeys = keys.filter((record) => record.id !== keyId);
  if (nextKeys.length === keys.length) {
    return res.status(404).json({ message: "LLM API key not found." });
  }

  user.llmApiKeys = nextKeys;
  await writeDb(db);
  console.info(`[llm-keys] Deleted key metadata for user ${user.id}.`);
  const catalog = await fetchLlmProviderCatalog({ allowStale: true });
  res.json({ keys: publicLlmApiKeysDto(user.llmApiKeys, catalog.providers) });
});

app.delete("/api/auth/me", requireAuth, async (req, res) => {
  const db = await readDb();
  const userId = req.user.id;
  const user = db.users.find((candidate) => candidate.id === userId);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  try {
    await deleteSupabaseAuthUser(user);
  } catch (error) {
    const deletionError = error as Error & { status?: number };
    return res
      .status(deletionError.status || 502)
      .json({ message: deletionError.message || "Unable to delete account." });
  }

  const activeUserIds = new Set(db.users.map((candidate) => candidate.id));
  const deletedRoomIds = new Set<string>();
  const ownershipTransferTimestamp = new Date().toISOString();
  const nextRooms = [];

  for (const room of db.rooms) {
    const remainingMemberIds = (room.memberIds || []).filter(
      (memberId) => memberId !== userId && activeUserIds.has(memberId),
    );

    if (room.ownerId !== userId) {
      nextRooms.push({
        ...room,
        memberIds: remainingMemberIds,
      });
      continue;
    }

    const nextOwnerId = remainingMemberIds[0];
    if (!nextOwnerId) {
      deletedRoomIds.add(room.id);
      continue;
    }

    nextRooms.push({
      ...room,
      ownerId: nextOwnerId,
      memberIds: remainingMemberIds,
      updatedAt: ownershipTransferTimestamp,
    });
  }

  const deletedPollIds = new Set(
    (db.coordinatePolls || [])
      .filter((poll) => deletedRoomIds.has(poll.roomId) || poll.createdBy === userId)
      .map((poll) => poll.id),
  );

  db.users = db.users.filter((candidate) => candidate.id !== userId);
  db.rooms = nextRooms;
  db.messages = db.messages.filter(
    (message) => !deletedRoomIds.has(message.roomId) && message.senderId !== userId,
  );
  db.resources = db.resources.filter(
    (resource) => !deletedRoomIds.has(resource.roomId) && resource.uploaderId !== userId,
  );
  db.annotations = (db.annotations || [])
    .filter((annotation) => !deletedRoomIds.has(annotation.roomId) && annotation.author?.id !== userId)
    .map((annotation) => ({
      ...annotation,
      replies: (annotation.replies || []).filter((reply) => reply.author?.id !== userId),
    }));
  db.sessions = db.sessions.filter(
    (session) => !deletedRoomIds.has(session.roomId) && session.createdBy !== userId,
  );
  db.coordinatePolls = (db.coordinatePolls || []).filter((poll) => !deletedPollIds.has(poll.id));
  db.coordinateResponses = (db.coordinateResponses || []).filter(
    (response) =>
      !deletedRoomIds.has(response.roomId) &&
      response.userId !== userId &&
      !deletedPollIds.has(response.pollId),
  );
  db.buddyThreads = (db.buddyThreads || []).filter(
    (thread) => !deletedRoomIds.has(thread.roomId) && thread.ownerId !== userId,
  );

  await writeDb(db);

  activeSocketByUser.delete(userId);
  roomActivityByRoom.forEach((activityByUser) => activityByUser.delete(userId));
  spacePresenceByRoom.forEach((presenceBySocket) => {
    presenceBySocket.forEach((presence, presenceKey) => {
      if (presence.userId === userId || deletedRoomIds.has(presence.roomId)) {
        presenceBySocket.delete(presenceKey);
      }
    });
  });
  meetingPresenceByRoom.forEach((presenceByArea, roomId) => {
    if (deletedRoomIds.has(roomId)) {
      meetingPresenceByRoom.delete(roomId);
      return;
    }
    presenceByArea.forEach((presenceByUser) => presenceByUser.delete(userId));
  });

  res.json({ message: "Account deleted." });
});

app.get("/api/rooms", requireAuth, async (req, res) => {
  const db = await readDb();
  const query = String(req.query.search || "").trim().toLowerCase();

  const rooms = db.rooms
    .filter((room) => canDiscoverRoom(room, req.user.id))
    .filter((room) => {
      if (!query) return true;
      return [
        room.name,
        room.moduleCode,
        room.description,
        ...(room.tags || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .map((room) => roomDto(db, room, req.user.id))
    .sort((a, b) => String(b.latestMessageAt).localeCompare(String(a.latestMessageAt)));

  res.json({ rooms });
});

app.post("/api/rooms", requireAuth, async (req, res) => {
  const db = await readDb();
  const now = new Date().toISOString();
  const name = String(req.body.name || "").trim();
  const moduleCode = String(req.body.moduleCode || "").trim().toUpperCase();
  const visibility = req.body.visibility === "private" ? "private" : "public";
  const password = String(req.body.password || "");

  if (!name || !moduleCode) {
    return res.status(400).json({ message: "Room name and module code are required." });
  }

  if (visibility === "private" && !password.trim()) {
    return res.status(400).json({ message: "Password is required for private room." });
  }

  const room = {
    id: createId("room"),
    name,
    moduleCode,
    academicTerm: String(req.body.academicTerm || "").trim(),
    roomLogo: String(req.body.roomLogo || "").trim(),
    description: String(req.body.description || "").trim(),
    visibility,
    tags: normalizeTags(req.body.tags),
    theme: String(req.body.theme || "twilight"),
    background: String(req.body.background || "aurora"),
    worldConfig: normalizeWorldConfig(req.body.worldConfig),
    channels: ["general"],
    channelLayout: normalizeRoomChannelLayout([], ["general"]),
    passwordHash:
      visibility === "private" ? await bcrypt.hash(password.trim(), 10) : null,
    ownerId: req.user.id,
    memberIds: [req.user.id],
    inviteCode: createInviteCode(),
    createdAt: now,
    updatedAt: now,
  };

  db.rooms.push(room);
  await writeDb(db);
  res.status(201).json({ room: roomDto(db, room, req.user.id) });
});

app.get("/api/rooms/:roomId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (!canViewRoom(room, req.user.id)) {
    return res.status(403).json({ message: "Use an invite link to join this world." });
  }

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.patch("/api/rooms/:roomId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can edit this room." });
  }

  const name = String(req.body.name ?? room.name).trim();
  const moduleCode = String(req.body.moduleCode ?? room.moduleCode).trim().toUpperCase();
  if (!name || !moduleCode) {
    return res.status(400).json({ message: "Room name and module code are required." });
  }

  room.name = name;
  room.moduleCode = moduleCode;
  room.academicTerm = String(req.body.academicTerm ?? room.academicTerm ?? "").trim();
  room.roomLogo = String(req.body.roomLogo ?? room.roomLogo ?? "").trim();
  room.description = String(req.body.description ?? room.description).trim();
  room.visibility = req.body.visibility === "private" ? "private" : "public";
  room.tags = normalizeTags(req.body.tags ?? room.tags);
  room.theme = String(req.body.theme || room.theme || "twilight");
  room.background = String(req.body.background || room.background || "aurora");
  if (Object.prototype.hasOwnProperty.call(req.body, "worldConfig")) {
    room.worldConfig = normalizeWorldConfig(req.body.worldConfig);
  }

  if (room.visibility === "private") {
    const password = String(req.body.password || "");
    if (password.trim()) {
      room.passwordHash = await bcrypt.hash(password.trim(), 10);
    } else if (!room.passwordHash) {
      return res.status(400).json({ message: "Password is required for private room." });
    }
  } else {
    room.passwordHash = null;
  }

  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id) });
});

app.post("/api/rooms/:roomId/channels", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  const channel = normalizeChannel(req.body.name);
  const type = req.body.type === "document" ? "document" : "text";
  const resourceId = type === "document" ? String(req.body.resourceId || "") : "";
  if (type === "document") {
    if (!resourceId) {
      return res.status(400).json({ message: "Choose a supported document for this channel." });
    }

    const resource = db.resources.find((candidate) => candidate.id === resourceId && candidate.roomId === room.id);
    if (!resource) return res.status(404).json({ message: "Resource not found." });
    if (!isDocumentChannelResource(resource)) {
      return res.status(400).json({
        message: documentChannelFileTypeMessage,
      });
    }
    await ensureOfficeResourceConversion(db, resource);
  }

  const newChannel = { name: channel, type, resourceId };
  room.channels = normalizeChannels([...(room.channels || []), newChannel]);
  room.channelLayout = normalizeRoomChannelLayout(room.channelLayout, room.channels);
  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.status(201).json({ room: roomDto(db, room, req.user.id), channel });
});

app.patch("/api/rooms/:roomId/channels/:channel", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  const currentChannel = normalizeChannel(req.params.channel);
  const nextChannel = normalizeChannel(req.body.name);
  const channels = normalizeChannels(room.channels);

  if (currentChannel === "general") {
    return res.status(400).json({ message: "The general channel cannot be renamed." });
  }

  if (!channels.some((channel) => channel.name === currentChannel)) {
    return res.status(404).json({ message: "Channel not found." });
  }

  if (channels.some((channel) => channel.name === nextChannel) && nextChannel !== currentChannel) {
    return res.status(409).json({ message: "A channel with that name already exists." });
  }

  const renamedChannels = normalizeChannels(
    channels.map((channel) =>
      channel.name === currentChannel ? { ...channel, name: nextChannel } : channel,
    ),
  );
  room.channelLayout = normalizeRoomChannelLayout(
    renameChannelInRoomLayout(room.channelLayout, channels, currentChannel, nextChannel),
    renamedChannels,
  );
  room.channels = renamedChannels;
  room.updatedAt = new Date().toISOString();

  db.messages = db.messages.map((message) =>
    message.roomId === room.id && normalizeChannel(message.channel) === currentChannel
      ? { ...message, channel: nextChannel }
      : message,
  );
  db.annotations = db.annotations.map((annotation) =>
    annotation.roomId === room.id && normalizeChannel(annotation.channel) === currentChannel
      ? { ...annotation, channel: nextChannel, updatedAt: new Date().toISOString() }
      : annotation,
  );

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id), channel: nextChannel });
});

app.delete("/api/rooms/:roomId/channels/:channel", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  const channel = normalizeChannel(req.params.channel);
  const channels = normalizeChannels(room.channels);

  if (channel === "general") {
    return res.status(400).json({ message: "The general channel cannot be deleted." });
  }

  if (!channels.some((candidate) => candidate.name === channel)) {
    return res.status(404).json({ message: "Channel not found." });
  }

  room.channels = normalizeChannels(channels.filter((candidate) => candidate.name !== channel));
  room.channelLayout = normalizeRoomChannelLayout(room.channelLayout, room.channels);
  room.updatedAt = new Date().toISOString();
  db.messages = db.messages.filter(
    (message) => message.roomId !== room.id || normalizeChannel(message.channel) !== channel,
  );
  db.annotations = db.annotations.filter(
    (annotation) => annotation.roomId !== room.id || normalizeChannel(annotation.channel) !== channel,
  );

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id), channel: "general" });
});

app.patch("/api/rooms/:roomId/channel-layout", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can manage channels." });
  }

  room.channelLayout = normalizeRoomChannelLayout(
    req.body?.channelLayout ?? req.body?.layout,
    room.channels,
  );
  room.updatedAt = new Date().toISOString();

  await writeDb(db);
  await emitRoomUpdated(db, room);
  res.json({ room: roomDto(db, room, req.user.id) });
});

app.get("/api/rooms/:roomId/channels/:channel/annotations", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotations = db.annotations
    .filter(
      (annotation) =>
        annotation.roomId === room.id &&
        normalizeChannel(annotation.channel) === channel.name,
    )
    .map(annotationDto);

  res.json({ annotations });
});

app.post("/api/rooms/:roomId/channels/:channel/annotations", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = createAnnotationRecord(room, channel, req.user, req.body);
  db.annotations.push(annotation);
  await writeDb(db);

  io.to(`room:${room.id}`).emit("annotation:new", annotation);
  res.status(201).json({ annotation });
});

app.patch("/api/rooms/:roomId/channels/:channel/annotations/:annotationId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
  if (!annotation) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  const result = updateAnnotationRecord(annotation, req.user, req.body);
  if (result.status) {
    return res.status(result.status).json({ message: result.message });
  }

  await writeDb(db);
  io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
  res.json({ annotation: result.annotation });
});

app.delete("/api/rooms/:roomId/channels/:channel/annotations/:annotationId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
  if (!annotation) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  if (getAnnotationAuthorId(annotation) !== req.user.id && room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the annotation author or room owner can delete it." });
  }

  db.annotations = db.annotations.filter((candidate) => candidate.id !== annotation.id);
  await writeDb(db);

  const payload = { id: annotation.id, channel: channel.name };
  io.to(`room:${room.id}`).emit("annotation:deleted", payload);
  res.json(payload);
});

app.post("/api/rooms/:roomId/channels/:channel/annotations/:annotationId/replies", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const channel = findNormalizedRoomChannel(room, req.params.channel);
  if (!channel) {
    return res.status(404).json({ message: "Channel not found." });
  }

  const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
  if (!annotation) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  const result = addAnnotationReply(annotation, req.user, req.body);
  if (result.status) {
    return res.status(result.status).json({ message: result.message });
  }

  await writeDb(db);
  io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
  res.status(201).json({ annotation: result.annotation, reply: result.reply });
});

app.delete(
  "/api/rooms/:roomId/channels/:channel/annotations/:annotationId/replies/:replyId",
  requireAuth,
  async (req, res) => {
    const db = await readDb();
    const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
    if (!room) return;

    const channel = findNormalizedRoomChannel(room, req.params.channel);
    if (!channel) {
      return res.status(404).json({ message: "Channel not found." });
    }

    const annotation = findAnnotationForChannel(db, room, channel, req.params.annotationId);
    if (!annotation) {
      return res.status(404).json({ message: "Annotation not found." });
    }

    const result = deleteAnnotationReply(annotation, room, req.user, req.params.replyId);
    if (result.status) {
      return res.status(result.status).json({ message: result.message });
    }

    await writeDb(db);
    io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
    res.json({ annotation: result.annotation, id: result.replyId });
  },
);

app.delete("/api/rooms/:roomId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the room owner can delete this room." });
  }

  const roomResources = db.resources.filter((resource) => resource.roomId === room.id);
  for (const resource of roomResources) {
    if (resource.type === "file" && resource.storageName) {
      await deleteStoredUploadFile(resource.storageName);
    }
    if (resource.type === "file" && resource.pdfPath) {
      await deleteStoredUploadFile(resource.pdfPath);
    }
  }

  db.rooms = db.rooms.filter((candidate) => candidate.id !== room.id);
  db.messages = db.messages.filter((message) => message.roomId !== room.id);
  db.resources = db.resources.filter((resource) => resource.roomId !== room.id);
  db.annotations = db.annotations.filter((annotation) => annotation.roomId !== room.id);
  db.sessions = db.sessions.filter((session) => session.roomId !== room.id);
  db.coordinatePolls = db.coordinatePolls.filter((poll) => poll.roomId !== room.id);
  db.coordinateResponses = db.coordinateResponses.filter((response) => response.roomId !== room.id);
  db.buddyThreads = db.buddyThreads.filter((thread) => thread.roomId !== room.id);
  await writeDb(db);

  clearChatbotCorpus(room.id).catch((error) => {
    console.warn(`[buddy] Failed to clear corpus for deleted room ${room.id}: ${error.message}`);
  });
  io.to(`room:${room.id}`).emit("room:deleted", { roomId: room.id });
  res.status(204).end();
});

app.post("/api/rooms/:roomId/join", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.visibility !== "public") {
    return res.status(403).json({ message: "Private rooms require an invite link." });
  }

  if (!isMember(room, req.user.id)) {
    room.memberIds.push(req.user.id);
    room.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.post("/api/rooms/:roomId/leave", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = findRoomOr404(db, req.params.roomId, res);
  if (!room) return;

  if (room.ownerId === req.user.id) {
    return res.status(400).json({
      message: "World owners cannot leave their own world.",
    });
  }

  if (!isMember(room, req.user.id)) {
    return res.status(400).json({ message: "You are not a member of this world." });
  }

  room.memberIds = (room.memberIds || []).filter((memberId) => memberId !== req.user.id);
  room.updatedAt = new Date().toISOString();
  await writeDb(db);

  io.sockets.sockets.forEach((socket) => {
    if (socket.user?.id !== req.user.id) return;
    removeSocketRoomActivity(socket, room.id);
    removeSocketSpacePresence(socket, room.id);
    removeSocketMeetingPresence(socket, room.id);
    socket.leave(`room:${room.id}`);
  });

  await emitRoomUpdated(db, room);
  io.to(`room:${room.id}`).emit("room:member-left", {
    roomId: room.id,
    userId: req.user.id,
  });

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.post("/api/invites/:inviteCode/join", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = db.rooms.find((candidate) => candidate.inviteCode === req.params.inviteCode);

  if (!room) {
    return res.status(404).json({ message: "Invite link not found." });
  }

  if (room.visibility === "private" && !isMember(room, req.user.id)) {
    const password = String(req.body?.password || "");
    if (!password) {
      return res.status(403).json({ message: "Private world password is required." });
    }

    if (!room.passwordHash || !(await bcrypt.compare(password, room.passwordHash))) {
      return res.status(403).json({ message: "Incorrect private world password." });
    }
  }

  if (!isMember(room, req.user.id)) {
    room.memberIds.push(req.user.id);
    room.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  res.json({ room: roomDto(db, room, req.user.id) });
});

app.get("/api/rooms/:roomId/messages", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const messages = db.messages
    .filter((message) => message.roomId === room.id)
    .map((message) => messageDto(db, message));

  res.json({ messages });
});

app.post("/api/rooms/:roomId/messages", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const body = String(req.body.body || "").trim();
  const attachments = normalizeMessageAttachments(req.body.attachments);
  const channel = normalizeChannel(req.body.channel);
  if (!body && !attachments.length) {
    return res.status(400).json({ message: "Message cannot be empty." });
  }

  room.channels = normalizeChannels([...(room.channels || []), channel]);

  const message = {
    id: createId("msg"),
    roomId: room.id,
    senderId: req.user.id,
    channel,
    body: body.slice(0, 2000),
    attachments,
    createdAt: new Date().toISOString(),
  };

  db.messages.push(message);
  await writeDb(db);

  const dto = messageDto(db, message);
  io.to(`room:${room.id}`).emit("message:new", dto);
  res.status(201).json({ message: dto });
});

app.get("/api/rooms/:roomId/resources", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const purgedExpiredResources = await purgeExpiredDeletedResources(db);
  const includeDeleted = req.query.includeDeleted === "true";
  const deletedOnly = req.query.deleted === "true";
  const roomResources = db.resources.filter((resource) => {
    if (resource.roomId !== room.id) return false;
    if (deletedOnly) return Boolean(resource.deletedAt);
    return includeDeleted || !resource.deletedAt;
  });
  let conversionStateChanged = false;
  for (const resource of roomResources) {
    if (await ensureOfficeResourceConversion(db, resource)) {
      conversionStateChanged = true;
    }
  }
  if (conversionStateChanged) {
    await writeDb(db);
  } else if (purgedExpiredResources) {
    await writeDb(db);
  }

  const resources = roomResources
    .filter((resource) => db.resources.some((candidate) => candidate.id === resource.id))
    .map((resource) => resourceDto(db, resource))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  res.json({ resources });
});

app.post("/api/rooms/:roomId/resources/url", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const title = String(req.body.title || "").trim();
  const url = String(req.body.url || "").trim();
  const folder = normalizeFolder(req.body.folder);

  if (isCanvasFolderPath(folder)) {
    return res.status(403).json({ message: "Canvas folders are managed by sync and cannot be changed here." });
  }

  if (!title || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ message: "Provide a title and a valid http(s) URL." });
  }

  const resource = {
    id: createId("res"),
    roomId: room.id,
    uploaderId: req.user.id,
    type: "url",
    title,
    folder,
    url,
    metadata: buildResourceMetadata({
      room,
      title,
      sourceType: "url",
      url,
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.resources.push(resource);
  await writeDb(db);
  emitResourceEvent(db, room.id, "resource:new", resource);
  res.status(201).json({ resource: resourceDto(db, resource) });
});

app.post(
  "/api/rooms/:roomId/resources/file",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    const db = await readDb();
    const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
    if (!room) return;

    if (!req.file) {
      return res.status(400).json({ message: "Choose a file to upload." });
    }

    if (isCanvasFolderPath(req.body.folder)) {
      await deleteStoredUploadFile(req.file.filename);
      return res.status(403).json({ message: "Canvas folders are managed by sync and cannot be changed here." });
    }

    await ensureRoomResourceFileMetadata(db, room);

    const uploadedPath = safeUploadPath(req.file.filename);
    if (req.body.purpose === "document-channel" && !isDocumentChannelUploadFile(req.file)) {
      await deleteStoredUploadFile(req.file.filename);
      return res.status(400).json({ message: documentChannelFileTypeMessage });
    }
    if (isBlockedResourceUpload(req.file)) {
      await deleteStoredUploadFile(req.file.filename);
      const extension = path.extname(req.file.originalname || "").toLowerCase() || "that file type";
      return res.status(400).json({
        message: `Executable or script files (${extension}) cannot be uploaded. Upload documents, images, archives, or other study materials instead.`,
      });
    }

    const contentHash = await hashUploadedFile(uploadedPath);
    const resourceType = detectResourceType(req.file.mimetype, req.file.originalname);
    const existingResource = db.resources.find(
      (resource) =>
        resource.roomId === room.id &&
        resource.type === "file" &&
        !isCanvasSyncedResource(resource) &&
        resource.contentHash &&
        resource.contentHash === contentHash,
    );

    if (existingResource) {
      if (existingResource.storageName) {
        await persistUploadBlobFromPath(existingResource.storageName, uploadedPath, {
          mimeType: existingResource.mimeType || req.file.mimetype,
          originalName: existingResource.originalName || req.file.originalname,
        });
      }
      // The new bytes are redundant, so remove only the temporary duplicate upload.
      await deleteStoredUploadFile(req.file.filename);
      const wasDeleted = Boolean(existingResource.deletedAt);
      let existingChanged = false;
      if (wasDeleted) {
        // Re-uploading an identical deleted file restores the canonical record
        // instead of creating a hidden duplicate with the same content hash.
        existingResource.deletedAt = "";
        existingResource.deletedById = "";
        existingResource.folder = normalizeFolder(req.body.folder);
        existingResource.originalFolder = "";
        existingResource.updatedAt = new Date().toISOString();
        existingChanged = true;
      }
      if (await ensureOfficeResourceConversion(db, existingResource)) {
        existingChanged = true;
      }
      if (existingChanged) {
        await writeDb(db);
        emitResourceEvent(db, room.id, "resource:updated", existingResource);
      }
      return res.status(200).json({
        resource: resourceDto(db, existingResource),
        deduplicated: true,
        restored: wasDeleted,
        message: "This file already exists in the room.",
      });
    }

    const title = String(req.body.title || req.file.originalname).trim();
    const now = new Date().toISOString();
    const resource = {
      id: createId("res"),
      roomId: room.id,
      uploaderId: req.user.id,
      type: "file",
      title,
      folder: normalizeFolder(req.body.folder),
      originalName: req.file.originalname,
      storageName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      contentHash,
      pdfPath: "",
      conversionStatus: resourceType === "docx" || resourceType === "pptx" ? "pending" : "not-needed",
      resourceType,
      metadata: buildResourceMetadata({
        room,
        title: req.file.originalname || title,
        sourceType: "file",
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`,
      }),
      url: `/uploads/${req.file.filename}`,
      createdAt: now,
      updatedAt: now,
      originalFolder: "",
      deletedById: "",
    };

    await persistUploadBlobFromPath(resource.storageName, uploadedPath, {
      mimeType: resource.mimeType,
      originalName: resource.originalName,
    });

    db.resources.push(resource);
    await writeDb(db);
    emitResourceEvent(db, room.id, "resource:new", resource);

    if (resourceType === "docx" || resourceType === "pptx") {
      res.status(201).json({ resource: resourceDto(db, resource) });
      startResourcePdfConversion({
        resourceId: resource.id,
        roomId: room.id,
        storageName: resource.storageName,
      });
      return;
    }

    res.status(201).json({ resource: resourceDto(db, resource) });
  },
);

app.get("/api/resources/:resourceId/file", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find((candidate) => candidate.id === req.params.resourceId);

  if (!resource || resource.deletedAt || resource.type !== "file" || !resource.storageName) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!room) {
    return res.status(404).json({ message: "Resource not found." });
  }

  if (!isMember(room, req.user.id)) {
    return res.status(403).json({ message: "Join the room to access this area." });
  }

  const fileBytes = await readUploadFileBuffer(resource.storageName);
  if (!fileBytes) {
    return res.status(404).json({ message: "Resource file not found." });
  }

  const filename =
    String(resource.originalName || resource.title || resource.storageName)
      .replace(/[\r\n"]/g, "")
      .trim() || "document";
  res.type(resource.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  return res.send(fileBytes);
});

app.patch("/api/resources/:resourceId", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find((candidate) => candidate.id === req.params.resourceId);

  if (!resource || resource.deletedAt) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!canManageResource(room, resource, req.user.id)) {
    return res.status(403).json({ message: "You cannot edit this resource." });
  }

  const nextTitle = String(req.body.title ?? "").trim();
  const nextFolder =
    req.body.folder == null ? resource.folder || "General" : normalizeFolder(req.body.folder);
  const metadataPatch = sanitizeResourceMetadataPatch(req.body.metadata);

  if (isCanvasSyncedResource(resource) || isCanvasFolderPath(nextFolder)) {
    return res.status(403).json({ message: "Canvas resources are managed by sync and cannot be edited or moved." });
  }

  if (req.body.title != null && !nextTitle) {
    return res.status(400).json({ message: "Resource name cannot be empty." });
  }

  if (nextTitle) resource.title = nextTitle.slice(0, 180);
  resource.folder = nextFolder;
  resource.metadata = {
    ...(resource.metadata || {}),
    ...metadataPatch,
  };
  resource.updatedAt = new Date().toISOString();

  await writeDb(db);
  emitResourceEvent(db, room.id, "resource:updated", resource);
  res.json({ resource: resourceDto(db, resource) });
});

app.patch("/api/rooms/:roomId/resources/folders", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const from = normalizeFolder(req.body.from);
  const to = normalizeFolder(req.body.to);
  if (!from || from === "General" || !to || from === to) {
    return res.status(400).json({ message: "Choose a valid folder to move." });
  }
  if (isCanvasFolderPath(from) || isCanvasFolderPath(to)) {
    return res.status(403).json({ message: "Canvas folders are managed by sync and cannot be moved." });
  }

  const now = new Date().toISOString();
  const movedResources = [];
  for (const resource of db.resources) {
    if (resource.roomId !== room.id || resource.deletedAt) continue;
    const folder = normalizeFolder(resource.folder);
    if (folder !== from && !folder.startsWith(`${from}/`)) continue;
    resource.folder = folder === from ? to : `${to}/${folder.slice(from.length + 1)}`;
    resource.updatedAt = now;
    movedResources.push(resource);
  }

  await writeDb(db);
  io.to(`room:${room.id}`).emit("resources:updated", {
    roomId: room.id,
    resources: movedResources.map((resource) => resourceDto(db, resource)),
  });
  res.json({ resources: movedResources.map((resource) => resourceDto(db, resource)) });
});

app.delete("/api/resources/:resourceId", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find(
    (candidate) => candidate.id === req.params.resourceId,
  );

  if (!resource) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!canManageResource(room, resource, req.user.id)) {
    return res.status(403).json({ message: "You cannot delete this resource." });
  }
  if (isCanvasSyncedResource(resource)) {
    return res.status(403).json({ message: "Canvas resources are managed by sync and cannot be deleted." });
  }

  resource.originalFolder = resource.originalFolder || resource.folder || "General";
  resource.deletedAt = resource.deletedAt || new Date().toISOString();
  resource.deletedById = req.user.id;
  resource.updatedAt = new Date().toISOString();
  await writeDb(db);
  emitResourceEvent(db, room.id, "resource:updated", resource);
  res.status(204).end();
});

app.patch("/api/resources/:resourceId/restore", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find(
    (candidate) => candidate.id === req.params.resourceId,
  );

  if (!resource) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!canManageResource(room, resource, req.user.id)) {
    return res.status(403).json({ message: "You cannot restore this resource." });
  }
  if (isCanvasSyncedResource(resource)) {
    return res.status(403).json({ message: "Canvas resources are managed by sync and cannot be restored here." });
  }

  resource.deletedAt = "";
  resource.deletedById = "";
  resource.originalFolder = "";
  resource.updatedAt = new Date().toISOString();
  await writeDb(db);
  emitResourceEvent(db, room.id, "resource:updated", resource);
  res.json({ resource: resourceDto(db, resource) });
});

app.delete("/api/resources/:resourceId/permanent", requireAuth, async (req, res) => {
  const db = await readDb();
  const resource = db.resources.find(
    (candidate) => candidate.id === req.params.resourceId,
  );

  if (!resource) {
    return res.status(404).json({ message: "Resource not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === resource.roomId);
  if (!canManageResource(room, resource, req.user.id)) {
    return res.status(403).json({ message: "You cannot permanently delete this resource." });
  }
  if (isCanvasSyncedResource(resource)) {
    return res.status(403).json({ message: "Canvas resources are managed by sync and cannot be permanently deleted." });
  }

  if (resource.type === "file" && resource.storageName) {
    await deleteStoredUploadFile(resource.storageName);
  }
  if (resource.type === "file" && resource.pdfPath) {
    await deleteStoredUploadFile(resource.pdfPath);
  }

  db.resources = db.resources.filter((candidate) => candidate.id !== resource.id);
  await writeDb(db);
  io.to(`room:${room.id}`).emit("resource:removed", {
    id: resource.id,
    roomId: room.id,
  });
  res.status(204).end();
});

app.get("/api/rooms/:roomId/buddy/threads", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const threads = (db.buddyThreads || [])
    .filter(
      (thread) =>
        thread.roomId === room.id &&
        canViewBuddyThread(thread, req.user.id) &&
        isSubstantiveBuddyThread(thread),
    )
    .map((thread) => buddyThreadDto(db, thread, req.user.id))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  res.json({ threads });
});

app.get("/api/rooms/:roomId/buddy/providers", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const providerStatus = getBuddyProviderStatus(user);
  const catalog = await fetchLlmProviderCatalog({ allowStale: true });

  res.json({
    providers: buildBuddyProviderOptions(user, {
      catalog: catalog.providers,
      providerStatus,
      byokRoutingAvailable: catalog.providers.length > 0,
    }),
    builtIn: providerStatus,
    providerCatalogAvailable: catalog.available,
    providerCatalogError: catalog.available ? "" : catalog.error,
    byokRouting: "server-chatbot",
  });
});

app.post("/api/rooms/:roomId/buddy/threads", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const now = new Date().toISOString();
  const thread = {
    id: createId("buddy"),
    roomId: room.id,
    ownerId: req.user.id,
    title: String(req.body.title || "New Chat").trim().slice(0, 60) || "New Chat",
    visibility: normalizeBuddyVisibility(req.body.visibility),
    messages: normalizeBuddyThreadMessages(req.body.messages, req.user),
    createdAt: now,
    updatedAt: now,
  };

  db.buddyThreads.push(thread);
  await writeDb(db);
  res.status(201).json({ thread: buddyThreadDto(db, thread, req.user.id) });
});

app.patch("/api/rooms/:roomId/buddy/threads/:threadId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const thread = (db.buddyThreads || []).find(
    (candidate) => candidate.id === req.params.threadId && candidate.roomId === room.id,
  );

  if (!thread || !canViewBuddyThread(thread, req.user.id)) {
    return res.status(404).json({ message: "Buddy chat not found." });
  }

  if (req.body.title !== undefined) {
    if (!canEditBuddyThread(thread, req.user.id)) {
      return res.status(403).json({ message: "Only the chat owner can rename this Buddy chat." });
    }
    thread.title = String(req.body.title || "New Chat").trim().slice(0, 60) || "New Chat";
  }

  if (req.body.visibility !== undefined) {
    if (!canEditBuddyThread(thread, req.user.id)) {
      return res.status(403).json({ message: "Only the chat owner can change visibility." });
    }
    thread.visibility = normalizeBuddyVisibility(req.body.visibility);
  }

  if (req.body.messages !== undefined) {
    if (thread.visibility !== "public" && !canEditBuddyThread(thread, req.user.id)) {
      return res.status(403).json({ message: "This Buddy chat is private." });
    }
    thread.messages = normalizeBuddyThreadMessages(req.body.messages, req.user);
  }

  thread.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ thread: buddyThreadDto(db, thread, req.user.id) });
});

app.delete("/api/rooms/:roomId/buddy/threads/:threadId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const thread = (db.buddyThreads || []).find(
    (candidate) => candidate.id === req.params.threadId && candidate.roomId === room.id,
  );

  if (!thread || !canViewBuddyThread(thread, req.user.id)) {
    return res.status(404).json({ message: "Buddy chat not found." });
  }

  if (!canEditBuddyThread(thread, req.user.id)) {
    return res.status(403).json({ message: "Only the chat owner can delete this Buddy chat." });
  }

  db.buddyThreads = (db.buddyThreads || []).filter((candidate) => candidate.id !== thread.id);
  await writeDb(db);
  res.status(204).end();
});

app.get("/api/rooms/:roomId/buddy/health", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const user = db.users.find((candidate) => candidate.id === req.user.id);
  const providerStatus = getBuddyProviderStatus(user);
  if (!providerStatus.available) {
    return res.json({
      ok: false,
      ...providerStatus,
      setupRequired: true,
      canConfigure: room.ownerId === req.user.id,
    });
  }

  try {
    const payload = await readChatbotHealthWithRetry(chatbotHealthTimeoutMs);
    res.json({
      ok: true,
      ...providerStatus,
      service: payload.message || "Intelligrate",
      setupRequired: false,
      canConfigure: room.ownerId === req.user.id,
    });
  } catch (error) {
    console.warn(`[buddy] Health check failed for ${room.id}: ${error.message}`);
    res.json({
      ok: false,
      available: false,
      code: "service_unavailable",
      provider: providerStatus.provider,
      providerLabel: providerStatus.providerLabel,
      message: "Intelligrate is not available yet. Start the chatbot service and try again.",
      setupRequired: true,
      canConfigure: room.ownerId === req.user.id,
    });
  }
});

app.post("/api/rooms/:roomId/buddy/title", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  const message = String(req.body.message || "").trim();
  if (!message) {
    return res.status(400).json({ message: "Provide a message to title." });
  }

  try {
    await reserveBuiltInLlmRequest(db, user);
    const title = await generateBuddyTitle(message);
    res.json({ title });
  } catch (error) {
    if (isBuiltInLlmQuotaSignal(error)) {
      const providerStatus = startBuiltInLlmQuotaCooldown(error.message);
      return res.status(429).json({
        ...providerStatus,
        message: providerStatus.message,
      });
    }
    if (error.status) {
      return res.status(error.status).json({
        code: error.code || undefined,
        message: error.message,
      });
    }
    console.warn(`[buddy] Title generation failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to generate an Intelligrate chat title.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/embed", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;
  const user = db.users.find((candidate) => candidate.id === req.user.id);
  if (!assertBuddyProviderAvailable(res, user)) return;

  try {
    // Manual sync should still respect the corpus fingerprint so Intelligrate
    // is embedded only when the room's supported files actually changed.
    res.json(await syncRoomResourcesWithChatbot(db, room));
  } catch (error) {
    if (isBuiltInLlmQuotaSignal(error)) {
      const providerStatus = startBuiltInLlmQuotaCooldown(error.message);
      return res.status(429).json({
        ...providerStatus,
        message: providerStatus.message,
      });
    }
    console.warn(`[buddy] Resource sync failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to sync room resources with Intelligrate.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/message", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  let providerSelection = null;
  try {
    const user = db.users.find((candidate) => candidate.id === req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Account not found." });
    }
    const requestedProviderKeyId = String(req.body.providerKeyId || BUILT_IN_LLM_PROVIDER_ID).trim();
    const providerStatus = getBuddyProviderStatus(user);
    const catalog =
      requestedProviderKeyId && requestedProviderKeyId !== BUILT_IN_LLM_PROVIDER_ID
        ? await requireLlmProviderCatalog()
        : { providers: [] };
    providerSelection = resolveBuddyProviderSelection(
      user,
      requestedProviderKeyId,
      catalog.providers,
      process.env,
      providerStatus,
    );
    const { messageChain, directResource, attachedResources } = resolveBuddyMessagePayload(
      db,
      room,
      req.body,
    );

    if (providerSelection.kind === "built-in") {
      await reserveBuiltInLlmRequest(db, user);
    }
    await syncRoomResourcesWithChatbot(db, room);

    console.info(
      `[buddy] Asking room ${room.id} via ${buddyProviderMeta(providerSelection).providerName} with ${
        directResource
          ? directResource.title
          : attachedResources.length
            ? `${attachedResources.length} synced attachment(s)`
            : "corpus only"
      }`,
    );
    const payload =
      providerSelection.kind === "built-in"
        ? await askChatbot({
            messageChain,
            roomId: room.id,
            resource: directResource,
          })
        : await askChatbot({
            messageChain,
            roomId: room.id,
            resource: directResource,
            llmModel: buddyProviderMeta(providerSelection).model,
            llmApiKey: providerSelection.apiKey,
          });
    const provider = buddyProviderMeta(providerSelection);

    res.json({
      answer: payload.answer || "",
      sources: enrichBuddySourcesForRoom(db, room, payload.sources || [], req.user.id),
      messageChain: payload.message_chain || [],
      directAttachment: directResource ? resourceDto(db, directResource) : null,
      provider,
    });
  } catch (error) {
    if (providerSelection?.kind === "built-in" && isBuiltInLlmQuotaSignal(error)) {
      const providerStatus = startBuiltInLlmQuotaCooldown(error.message);
      return res.status(429).json({
        ...providerStatus,
        message: providerStatus.message,
      });
    }
    if (error.status) {
      return res.status(error.status).json({
        code: error.code || undefined,
        message: error.message,
      });
    }

    console.warn(`[buddy] Message failed for ${room.id}: ${error.message}`);
    res.status(502).json({
      message: error.message || "Unable to get a response from Intelligrate.",
    });
  }
});

app.post("/api/rooms/:roomId/buddy/message/stream", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  let providerSelection = null;
  try {
    const user = db.users.find((candidate) => candidate.id === req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Account not found." });
    }
    const requestedProviderKeyId = String(req.body.providerKeyId || BUILT_IN_LLM_PROVIDER_ID).trim();
    const providerStatus = getBuddyProviderStatus(user);
    const catalog =
      requestedProviderKeyId && requestedProviderKeyId !== BUILT_IN_LLM_PROVIDER_ID
        ? await requireLlmProviderCatalog()
        : { providers: [] };
    providerSelection = resolveBuddyProviderSelection(
      user,
      requestedProviderKeyId,
      catalog.providers,
      process.env,
      providerStatus,
    );
    const { messageChain, directResource, attachedResources } = resolveBuddyMessagePayload(
      db,
      room,
      req.body,
    );

    if (providerSelection.kind === "built-in") {
      await reserveBuiltInLlmRequest(db, user);
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    res.flush?.();

    const writeSse = (event, data = "") => {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      const lines = String(payload).split(/\r?\n/);
      res.write(`event: ${event}\n${lines.map((line) => `data: ${line}`).join("\n")}\n\n`);
      res.flush?.();
    };

    const forwardChatbotSseBlock = (block) => {
      const trimmed = String(block || "").trim();
      if (!trimmed || trimmed.startsWith(":")) return;

      let eventName = "message";
      const dataLines = [];
      for (const line of String(block).split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).replace(/^ /, ""));
        }
      }

      const data = dataLines.join("\n");
      if (eventName === "error" && providerSelection.kind === "built-in") {
        let payload = {};
        try {
          payload = JSON.parse(data || "{}");
        } catch {
          payload = {};
        }
        const message = payload?.message || data;
        if (isBuiltInLlmQuotaSignal(message)) {
          const providerStatus = startBuiltInLlmQuotaCooldown(message);
          writeSse("error", {
            code: providerStatus.code,
            message: providerStatus.message,
          });
          return;
        }
      }

      if (eventName === "sources") {
        let parsedSources = [];
        try {
          parsedSources = JSON.parse(data || "[]");
        } catch {
          parsedSources = [];
        }
        writeSse("sources", enrichBuddySourcesForRoom(db, room, parsedSources, req.user.id));
        return;
      }

      writeSse(eventName, data);
    };

    await syncRoomResourcesWithChatbot(db, room);

    console.info(
      `[buddy] Streaming room ${room.id} via ${buddyProviderMeta(providerSelection).providerName} with ${
        directResource
          ? directResource.title
          : attachedResources.length
            ? `${attachedResources.length} synced attachment(s)`
            : "corpus only"
      }`,
    );

    const response = await streamChatbot({
      messageChain,
      roomId: room.id,
      resource: directResource,
      llmModel: providerSelection.kind === "built-in" ? "" : buddyProviderMeta(providerSelection).model,
      llmApiKey: providerSelection.kind === "built-in" ? "" : providerSelection.apiKey,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundaryIndex = sseBuffer.indexOf("\n\n");
      while (boundaryIndex >= 0) {
        const block = sseBuffer.slice(0, boundaryIndex);
        sseBuffer = sseBuffer.slice(boundaryIndex + 2);
        forwardChatbotSseBlock(block);
        boundaryIndex = sseBuffer.indexOf("\n\n");
      }
    }
    sseBuffer += decoder.decode().replace(/\r\n/g, "\n");
    if (sseBuffer.trim()) {
      forwardChatbotSseBlock(sseBuffer);
    }

    res.end();
  } catch (error) {
    if (providerSelection?.kind === "built-in" && isBuiltInLlmQuotaSignal(error)) {
      const providerStatus = startBuiltInLlmQuotaCooldown(error.message);
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ code: providerStatus.code, message: providerStatus.message })}\n\n`,
        );
        return res.end();
      }
      return res.status(429).json({
        ...providerStatus,
        message: providerStatus.message,
      });
    }
    if (error.status) {
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ code: error.code || undefined, message: error.message })}\n\n`,
        );
        return res.end();
      }
      return res.status(error.status).json({
        code: error.code || undefined,
        message: error.message,
      });
    }

    console.warn(`[buddy] Stream failed for ${room.id}: ${error.message}`);
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      return res.end();
    }

    return res.status(502).json({
      message: error.message || "Unable to stream a response from Intelligrate.",
    });
  }
});

app.get("/api/rooms/:roomId/sessions", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const sessions = db.sessions
    .filter((session) => session.roomId === room.id)
    .filter((session) => isSessionVisibleToUser(session, req.user.id))
    .map((session) => sessionDto(db, session))
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));

  res.json({ sessions });
});

app.post("/api/rooms/:roomId/sessions", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const title = String(req.body.title || "").trim();
  const startsAt = String(req.body.startsAt || "").trim();
  const startsAtDate = new Date(startsAt);
  const endsAt = normalizeOptionalIso(req.body.endsAt);
  const kind = normalizeSessionKind(req.body.kind);
  const visibility = normalizeSessionVisibility(req.body.visibility);
  const color = normalizeSessionColor(req.body.color);

  if (!title || Number.isNaN(startsAtDate.getTime())) {
    return res.status(400).json({ message: "Event title and date/time are required." });
  }

  if (endsAt && Date.parse(endsAt) <= startsAtDate.getTime()) {
    return res.status(400).json({ message: "End time must be after the start time." });
  }

  const coordinatePollId = String(req.body.coordinatePollId || "").trim();
  const coordinatePoll = coordinatePollId
    ? db.coordinatePolls.find((poll) => poll.id === coordinatePollId && poll.roomId === room.id)
    : null;
  const allDay = Boolean(req.body.allDay);

  if (coordinatePollId && !coordinatePoll) {
    return res.status(404).json({ message: "Meetup window not found." });
  }

  if (coordinatePollId && room.ownerId !== req.user.id) {
    return res.status(403).json({ message: "Only the owner can schedule a meetup window." });
  }

  const session = {
    id: createId("ses"),
    roomId: room.id,
    createdBy: req.user.id,
    title: title.slice(0, 140),
    agenda: String(req.body.agenda || "").trim(),
    startsAt: startsAtDate.toISOString(),
    endsAt,
    kind,
    visibility,
    location: String(req.body.location || "").trim().slice(0, 160),
    source: "manual",
    sourceId: "",
    metadata: {
      ...(coordinatePollId ? { coordinatePollId } : {}),
      ...(allDay ? { allDay: true } : {}),
      ...(color ? { color } : {}),
    },
    createdAt: new Date().toISOString(),
  };

  db.sessions.push(session);
  if (coordinatePoll) {
    coordinatePoll.scheduledSessionId = session.id;
    coordinatePoll.updatedAt = session.createdAt;
  }
  await writeDb(db);
  emitSessionsUpdated(db, room);
  if (coordinatePoll) emitCoordinateUpdated(db, room);
  res.status(201).json({ session: sessionDto(db, session) });
});

app.get("/api/rooms/:roomId/coordinate", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  res.json(coordinateDto(db, room));
});

app.put("/api/rooms/:roomId/coordinate/poll", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const rangeStart = normalizeOptionalIso(req.body.rangeStart);
  const rangeEnd = normalizeOptionalIso(req.body.rangeEnd);
  const slotMinutes = Math.min(180, Math.max(15, Number(req.body.slotMinutes) || 60));
  const dayStartMinutes = normalizeMinuteOfDay(req.body.dayStartMinutes, 9 * 60);
  const dayEndMinutes = normalizeMinuteOfDay(req.body.dayEndMinutes, 17 * 60);

  if (!rangeStart || !rangeEnd || Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
    return res.status(400).json({ message: "Choose a valid Coordinate date range." });
  }

  if (dayEndMinutes <= dayStartMinutes) {
    return res.status(400).json({ message: "Meetup window end time must be after the start time." });
  }

  const selectedDates = normalizeSelectedDates(req.body.selectedDates, rangeStart, rangeEnd);
  const now = new Date().toISOString();
  const pollId = String(req.body.pollId || "").trim();
  const existingPoll = pollId
    ? db.coordinatePolls.find((poll) => poll.id === pollId && poll.roomId === room.id)
    : null;

  if (pollId && !existingPoll) {
    return res.status(404).json({ message: "Meetup window not found." });
  }

  if (existingPoll?.scheduledSessionId) {
    return res.status(409).json({ message: "Scheduled meetup windows are locked. Delete the scheduled event first to reopen it." });
  }

  if (existingPoll) {
    existingPoll.title = String(req.body.title || "Group availability").trim().slice(0, 140);
    existingPoll.rangeStart = rangeStart;
    existingPoll.rangeEnd = rangeEnd;
    existingPoll.slotMinutes = slotMinutes;
    existingPoll.dayStartMinutes = dayStartMinutes;
    existingPoll.dayEndMinutes = dayEndMinutes;
    existingPoll.selectedDates = selectedDates;
    existingPoll.timezone = String(req.body.timezone || "Asia/Singapore").trim().slice(0, 80);
    existingPoll.updatedAt = now;
  } else {
    db.coordinatePolls.push({
      id: createId("cop"),
      roomId: room.id,
      createdBy: req.user.id,
      title: String(req.body.title || "Group availability").trim().slice(0, 140),
      rangeStart,
      rangeEnd,
      slotMinutes,
      dayStartMinutes,
      dayEndMinutes,
      selectedDates,
      timezone: String(req.body.timezone || "Asia/Singapore").trim().slice(0, 80),
      scheduledSessionId: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeDb(db);
  const payload = coordinateDto(db, room);
  emitCoordinateUpdated(db, room);
  res.json(payload);
});

app.delete("/api/rooms/:roomId/coordinate/poll/:pollId", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const poll = db.coordinatePolls.find((candidate) => candidate.id === req.params.pollId && candidate.roomId === room.id);
  if (!poll) {
    return res.status(404).json({ message: "Meetup window not found." });
  }

  if (poll.scheduledSessionId) {
    return res.status(409).json({ message: "Delete the scheduled calendar event before deleting this meetup window." });
  }

  db.coordinatePolls = db.coordinatePolls.filter((candidate) => candidate.id !== poll.id);
  db.coordinateResponses = db.coordinateResponses.filter((response) => response.pollId !== poll.id);
  await writeDb(db);
  const payload = coordinateDto(db, room);
  emitCoordinateUpdated(db, room);
  res.json(payload);
});

app.put("/api/rooms/:roomId/coordinate/availability", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomMember(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  const poll = db.coordinatePolls.find(
    (candidate) => candidate.id === req.body.pollId && candidate.roomId === room.id,
  );

  if (!poll) {
    return res.status(404).json({ message: "Create a Coordinate date range before saving availability." });
  }

  if (poll.scheduledSessionId) {
    return res.status(409).json({ message: "This meetup window has already been scheduled." });
  }

  const slots = normalizeAvailabilitySlots(req.body.slots).filter((slot) => availabilitySlotAllowedForPoll(slot, poll));
  const now = new Date().toISOString();
  const existingResponse = db.coordinateResponses.find(
    (response) => response.pollId === poll.id && response.userId === req.user.id,
  );

  if (!slots.length) {
    db.coordinateResponses = db.coordinateResponses.filter(
      (response) => !(response.pollId === poll.id && response.userId === req.user.id),
    );
    poll.updatedAt = now;
    await writeDb(db);
    const payload = coordinateDto(db, room);
    emitCoordinateUpdated(db, room);
    return res.json(payload);
  }

  if (existingResponse) {
    existingResponse.slots = slots;
    existingResponse.updatedAt = now;
  } else {
    db.coordinateResponses.push({
      id: createId("cor"),
      pollId: poll.id,
      roomId: room.id,
      userId: req.user.id,
      slots,
      updatedAt: now,
    });
  }

  poll.updatedAt = now;
  await writeDb(db);
  const payload = coordinateDto(db, room);
  emitCoordinateUpdated(db, room);
  res.json(payload);
});

app.post("/api/rooms/:roomId/integrations/canvas/courses", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const host = normalizeCanvasHost(req.body.host);
    const accessToken = String(req.body.accessToken || "").trim();
    if (!accessToken) {
      return res.status(400).json({ message: "Canvas access token is required." });
    }

    const payload = await fetchCanvasJson(host, accessToken, "/api/v1/courses", {
      enrollment_state: "active",
      per_page: 100,
    });
    const courses = (Array.isArray(payload) ? payload : [])
      .map((course) => ({
        id: String(course.id || ""),
        name: String(course.name || course.course_code || "Untitled course"),
        courseCode: String(course.course_code || ""),
        startAt: course.start_at || "",
        endAt: course.end_at || "",
      }))
      .filter((course) => course.id);

    res.json({ courses });
  } catch (err) {
    res.status(err.status || 502).json({ message: err.message || "Unable to connect to Canvas." });
  }
});

app.post("/api/rooms/:roomId/integrations/canvas/import", requireAuth, async (req, res) => {
  const db = await readDb();
  const room = assertRoomOwner(db, req.params.roomId, req.user.id, res);
  if (!room) return;

  try {
    const host = normalizeCanvasHost(req.body.host);
    const accessToken = String(req.body.accessToken || "").trim();
    const courseId = String(req.body.courseId || "").trim();
    const courseName = String(req.body.courseName || room.moduleCode || "Canvas").trim().slice(0, 140);

    if (!accessToken || !courseId) {
      return res.status(400).json({ message: "Canvas access token and course are required." });
    }

    const assignments = await fetchCanvasJson(
      host,
      accessToken,
      `/api/v1/courses/${encodeURIComponent(courseId)}/assignments`,
      {
        per_page: 100,
      },
    );
    const canvasFiles = await fetchCanvasCourseFiles(host, accessToken, courseId);
    const existingSourceIds = new Set(
      db.sessions
        .filter((session) => session.roomId === room.id && session.source === "canvas")
        .map((session) => session.sourceId),
    );
    const now = new Date().toISOString();
    const importedSessions = [];

    (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
      const dueAt = normalizeOptionalIso(assignment?.due_at);
      const sourceId = `${courseId}:${assignment?.id || assignment?.html_url || assignment?.name || ""}`;
      if (!dueAt || existingSourceIds.has(sourceId)) return;

      const session = {
        id: createId("ses"),
        roomId: room.id,
        createdBy: req.user.id,
        title: String(assignment?.name || "Canvas deadline").trim().slice(0, 140),
        agenda: stripHtml(assignment?.description),
        startsAt: dueAt,
        endsAt: "",
        kind: "deadline",
        visibility: "room",
        location: courseName,
        source: "canvas",
        sourceId,
        metadata: {
          canvasHost: host,
          courseId,
          courseName,
          htmlUrl: assignment?.html_url || "",
        },
        createdAt: now,
      };

      db.sessions.push(session);
      importedSessions.push(session);
      existingSourceIds.add(sourceId);
    });

    db.resources = db.resources.filter(
      (resource) => !(resource.roomId === room.id && resource.metadata?.source === "canvas-file"),
    );
    const importedResources = canvasFiles.map((file) => {
      const resourceType = detectResourceType(file.mimeType, file.title);
      const sourceId = `${courseId}:${file.id}`;
      const resource = {
        id: createId("res"),
        roomId: room.id,
        uploaderId: req.user.id,
        type: "url",
        title: file.title,
        folder: file.folder,
        originalName: file.title,
        storageName: "",
        mimeType: file.mimeType,
        size: file.size,
        contentHash: "",
        pdfPath: "",
        pdfConversionVersion: "",
        conversionStatus: "not-needed",
        resourceType,
        metadata: {
          ...buildResourceMetadata({
            room,
            title: file.title,
            sourceType: "canvas-file",
            mimeType: file.mimeType,
            size: file.size,
            url: file.url,
          }),
          canvasHost: host,
          courseId,
          courseName,
          source: "canvas-file",
          sourceId,
          syncedFolder: file.folder,
          syncedAt: now,
        },
        url: file.url,
        deletedAt: "",
        deletedById: "",
        originalFolder: "",
        createdAt: now,
        updatedAt: file.updatedAt || now,
      };
      db.resources.push(resource);
      return resource;
    });

    room.integrations = {
      ...(room.integrations || {}),
      canvas: {
        connected: true,
        host,
        courseId,
        courseName,
        courseCode: String(req.body.courseCode || "").trim().slice(0, 80),
        connectedAt: room.integrations?.canvas?.connectedAt || now,
        lastSyncedAt: now,
        importedDeadlineCount:
          Number(room.integrations?.canvas?.importedDeadlineCount || 0) + importedSessions.length,
        importedFileCount: importedResources.length,
      },
    };
    room.updatedAt = now;

    await writeDb(db);
    io.to(`room:${room.id}`).emit("resources:synced", {
      roomId: room.id,
      resources: db.resources
        .filter((resource) => resource.roomId === room.id)
        .map((resource) => resourceDto(db, resource)),
    });
    emitSessionsUpdated(db, room);
    await emitRoomUpdated(db, room);
    res.status(201).json({
      imported: importedSessions.length,
      importedResources: importedResources.length,
      resources: importedResources.map((resource) => resourceDto(db, resource)),
      sessions: importedSessions.map((session) => sessionDto(db, session)),
      room: roomDto(db, room, req.user.id),
    });
  } catch (err) {
    res.status(err.status || 502).json({ message: err.message || "Unable to import Canvas deadlines." });
  }
});

app.delete("/api/sessions/:sessionId", requireAuth, async (req, res) => {
  const db = await readDb();
  const session = db.sessions.find((candidate) => candidate.id === req.params.sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  const room = db.rooms.find((candidate) => candidate.id === session.roomId);
  if (!room || (room.ownerId !== req.user.id && session.createdBy !== req.user.id)) {
    return res.status(403).json({ message: "You cannot delete this session." });
  }

  db.sessions = db.sessions.filter((candidate) => candidate.id !== session.id);
  db.coordinatePolls = (db.coordinatePolls || []).map((poll) =>
    poll.scheduledSessionId === session.id ? { ...poll, scheduledSessionId: "", updatedAt: new Date().toISOString() } : poll,
  );
  await writeDb(db);
  emitSessionsUpdated(db, room);
  emitCoordinateUpdated(db, room);
  res.status(204).end();
});

io.use(async (socket, next) => {
  const user = await getUserByToken(socket.handshake.auth?.token);
  if (!user) {
    return next(new Error("Authentication failed."));
  }

  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  registerSingleActiveUserSocket(socket);

  socket.on("room:join", async (roomId, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before chatting." });
        return;
      }

      socket.join(`room:${room.id}`);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to join the room right now." });
    }
  });

  socket.on("room:activity:set", async (payload, ack) => {
    try {
      const db = await readDb();
      const existingRoomActivity = findSocketRoomActivity(socket);
      const requestedRoomId = payload?.roomId || existingRoomActivity?.roomId;
      const room = db.rooms.find((candidate) => candidate.id === requestedRoomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before updating activity." });
        return;
      }

      const roomActivity = getRoomActivity(room.id);
      const previousActivity =
        existingRoomActivity?.roomId === room.id
          ? existingRoomActivity.activity
          : roomActivity.get(socket.user.id);
      const tabId = normalizeRoomActivityTab(payload?.tabId) || previousActivity?.tabId;
      if (!tabId) {
        ack?.({ ok: false, message: "Room activity tab is invalid." });
        return;
      }

      const profileStatus =
        payload?.profileStatus === undefined
          ? previousActivity?.profileStatus || "online"
          : normalizeProfileStatus(payload?.profileStatus);
      const hasDocumentChannel = Object.prototype.hasOwnProperty.call(payload || {}, "documentChannel");
      const hasDocumentPage = Object.prototype.hasOwnProperty.call(payload || {}, "documentPage");
      const rawDocumentChannel = String(payload?.documentChannel || "").trim();
      const documentChannel = hasDocumentChannel
        ? rawDocumentChannel
          ? normalizeChannel(rawDocumentChannel)
          : ""
        : previousActivity?.documentChannel;
      const documentPage = hasDocumentPage
        ? payload?.documentPage == null || payload?.documentPage === ""
          ? null
          : normalizeDocumentPage(payload?.documentPage, previousActivity?.documentPage)
        : previousActivity?.documentPage;
      const nextActivity = {
        ...previousActivity,
        profileStatus,
        roomId: room.id,
        userId: socket.user.id,
        user: publicUser(socket.user),
        tabId,
        socketId: socket.id,
        updatedAt: new Date().toISOString(),
      };

      if (tabId === "chat" && documentChannel && Number.isFinite(documentPage)) {
        nextActivity.documentChannel = documentChannel;
        nextActivity.documentPage = documentPage;
      } else {
        delete nextActivity.documentChannel;
        delete nextActivity.documentPage;
      }

      roomActivity.set(socket.user.id, nextActivity);

      socket.join(`room:${room.id}`);
      updateSocketSpaceProfileStatus(socket, room.id, profileStatus);
      updateSocketMeetingProfileStatus(socket, room.id, profileStatus);
      const members = serializeRoomActivity(room.id);
      io.to(`room:${room.id}`).emit("room:activity:state", {
        roomId: room.id,
        members,
      });
      emitMeetingSummary(room.id, socket);
      ack?.({ ok: true, members, meetings: serializeMeetingSummary(room.id) });
    } catch {
      ack?.({ ok: false, message: "Unable to update room activity right now." });
    }
  });

  socket.on("space:join", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before entering Limeets." });
        return;
      }

      const position = normalizeSpacePosition(payload?.position, DEFAULT_SPACE_TILE);
      const profileStatus = normalizeProfileStatus(payload?.profileStatus);
      const roomPresence = getSpacePresence(room.id);
      const presence = {
        presenceId: socket.id,
        profileStatus,
        roomId: room.id,
        userId: socket.user.id,
        user: publicUser(socket.user),
        position,
        socketId: socket.id,
        updatedAt: new Date().toISOString(),
      };

      socket.join(getSpaceRoomKey(room.id));
      roomPresence.set(socket.id, presence);

      const users = serializeSpacePresence(room.id);
      io.to(getSpaceRoomKey(room.id)).emit("space:state", {
        roomId: room.id,
        users,
      });
      ack?.({ ok: true, users, meetings: serializeMeetingSummary(room.id) });
    } catch {
      ack?.({ ok: false, message: "Unable to enter Limeets right now." });
    }
  });

  socket.on("space:move", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before moving in Limeets." });
        return;
      }

      const position = normalizeSpacePosition(payload?.position);
      if (!position) {
        ack?.({ ok: false, message: "Avatar position is invalid." });
        return;
      }

      const roomPresence = getSpacePresence(room.id);
      const currentPresence = roomPresence.get(socket.id);
      if (!currentPresence || currentPresence.socketId !== socket.id) {
        ack?.({ ok: false, message: "Enter Limeets before moving." });
        return;
      }
      const profileStatus = normalizeProfileStatus(payload?.profileStatus ?? currentPresence.profileStatus);

      const presence = {
        ...currentPresence,
        profileStatus,
        position,
        updatedAt: new Date().toISOString(),
      };

      roomPresence.set(socket.id, presence);
      if (profileStatus === "invisible") {
        io.to(getSpaceRoomKey(room.id)).emit("space:state", {
          roomId: room.id,
          users: serializeSpacePresence(room.id),
        });
      } else {
        socket.to(getSpaceRoomKey(room.id)).emit("space:user-moved", {
          presenceId: socket.id,
          profileStatus,
          roomId: room.id,
          userId: socket.user.id,
          user: publicUser(socket.user),
          position,
        });
      }
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to move in Limeets right now." });
    }
  });

  socket.on("space:leave", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Study Space room not found." });
        return;
      }

      removeSocketSpacePresence(socket, room.id);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to leave Limeets right now." });
    }
  });

  socket.on("meeting:join", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before entering a Meeting Area." });
        return;
      }

      if (!areaId) {
        ack?.({ ok: false, message: "Meeting Area is invalid." });
        return;
      }

      const profileStatus = normalizeProfileStatus(payload?.profileStatus);
      removeSocketMeetingPresence(socket, room.id);

      const areaPresence = getMeetingAreaPresence(room.id, areaId);
      const presence = {
        roomId: room.id,
        areaId,
        profileStatus,
        userId: socket.user.id,
        user: publicUser(socket.user),
        media: normalizeMeetingMedia(payload?.media),
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
      };

      socket.join(getMeetingRoomKey(room.id, areaId));
      areaPresence.set(socket.user.id, presence);

      const users = serializeMeetingPresence(room.id, areaId);
      const { socketId: _socketId, ...publicPresence } = presence;
      if (profileStatus !== "invisible") {
        socket.to(getMeetingRoomKey(room.id, areaId)).emit("meeting:user-joined", {
          ...publicPresence,
        });
      }
      emitMeetingState(room.id, areaId);
      emitMeetingSummary(room.id);
      ack?.({ ok: true, users });
    } catch {
      ack?.({ ok: false, message: "Unable to join the Meeting Area right now." });
    }
  });

  socket.on("meeting:leave", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Meeting Area room not found." });
        return;
      }

      removeSocketMeetingPresence(socket, room.id, areaId);
      emitMeetingSummary(room.id);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to leave the Meeting Area right now." });
    }
  });

  socket.on("meeting:media-state", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);

      if (!room || !isMember(room, socket.user.id) || !areaId) {
        ack?.({ ok: false, message: "Meeting Area is invalid." });
        return;
      }

      const areaPresence = meetingPresenceByRoom.get(room.id)?.get(areaId);
      const currentPresence = areaPresence?.get(socket.user.id);
      if (!currentPresence || currentPresence.socketId !== socket.id) {
        ack?.({ ok: false, message: "Join the Meeting Area before updating media." });
        return;
      }

      const media = normalizeMeetingMedia(payload?.media);
      areaPresence.set(socket.user.id, {
        ...currentPresence,
        media,
      });

      io.to(getMeetingRoomKey(room.id, areaId)).emit("meeting:user-media", {
        roomId: room.id,
        areaId,
        userId: socket.user.id,
        media,
      });
      emitMeetingSummary(room.id);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to update media state right now." });
    }
  });

  socket.on("meeting:signal", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const areaId = normalizeMeetingAreaId(payload?.areaId);
      const targetUserId = String(payload?.targetUserId || "").trim();
      const signal = normalizeMeetingSignal(payload?.signal);

      if (!room || !isMember(room, socket.user.id) || !areaId || !targetUserId || !signal) {
        ack?.({ ok: false, message: "Meeting signal is invalid." });
        return;
      }

      const areaPresence = meetingPresenceByRoom.get(room.id)?.get(areaId);
      const sender = areaPresence?.get(socket.user.id);
      const target = areaPresence?.get(targetUserId);
      if (!sender || sender.socketId !== socket.id || !target) {
        ack?.({ ok: false, message: "Meeting participant is unavailable." });
        return;
      }

      io.to(target.socketId).emit("meeting:signal", {
        roomId: room.id,
        areaId,
        fromUserId: socket.user.id,
        fromUser: publicUser(socket.user),
        signal,
      });
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, message: "Unable to relay meeting signal right now." });
    }
  });

  socket.on("annotation:create", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before annotating documents." });
        return;
      }

      const channel = findNormalizedRoomChannel(room, payload?.channel);
      if (!channel) {
        ack?.({ ok: false, message: "Channel not found." });
        return;
      }

      const annotation = createAnnotationRecord(room, channel, socket.user, payload);
      db.annotations.push(annotation);
      await writeDb(db);

      io.to(`room:${room.id}`).emit("annotation:new", annotation);
      ack?.({ ok: true, annotation });
    } catch {
      ack?.({ ok: false, message: "Unable to create the annotation right now." });
    }
  });

  socket.on("annotation:update", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before updating annotations." });
        return;
      }

      const channel = findNormalizedRoomChannel(room, payload?.channel);
      if (!channel) {
        ack?.({ ok: false, message: "Channel not found." });
        return;
      }

      const annotation = findAnnotationForChannel(db, room, channel, payload?.annotationId);
      if (!annotation) {
        ack?.({ ok: false, message: "Annotation not found." });
        return;
      }

      const result = updateAnnotationRecord(annotation, socket.user, payload);
      if (result.status) {
        ack?.({ ok: false, message: result.message });
        return;
      }

      await writeDb(db);
      io.to(`room:${room.id}`).emit("annotation:updated", result.annotation);
      ack?.({ ok: true, annotation: result.annotation });
    } catch {
      ack?.({ ok: false, message: "Unable to update the annotation right now." });
    }
  });

  socket.on("annotation:delete", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before deleting annotations." });
        return;
      }

      const channel = findNormalizedRoomChannel(room, payload?.channel);
      if (!channel) {
        ack?.({ ok: false, message: "Channel not found." });
        return;
      }

      const annotation = findAnnotationForChannel(db, room, channel, payload?.annotationId);
      if (!annotation) {
        ack?.({ ok: false, message: "Annotation not found." });
        return;
      }

      if (getAnnotationAuthorId(annotation) !== socket.user.id && room.ownerId !== socket.user.id) {
        ack?.({ ok: false, message: "Only the annotation author or room owner can delete it." });
        return;
      }

      db.annotations = db.annotations.filter((candidate) => candidate.id !== annotation.id);
      await writeDb(db);

      const deleted = { id: annotation.id, channel: channel.name };
      io.to(`room:${room.id}`).emit("annotation:deleted", deleted);
      ack?.({ ok: true, ...deleted });
    } catch {
      ack?.({ ok: false, message: "Unable to delete the annotation right now." });
    }
  });

  socket.on("message:send", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);

      if (!room || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Join the room before chatting." });
        return;
      }

      const body = String(payload?.body || "").trim();
      const attachments = normalizeMessageAttachments(payload?.attachments);
      const channel = normalizeChannel(payload?.channel);
      if (!body && !attachments.length) {
        ack?.({ ok: false, message: "Message cannot be empty." });
        return;
      }

      room.channels = normalizeChannels([...(room.channels || []), channel]);

      const message = {
        id: createId("msg"),
        roomId: room.id,
        senderId: socket.user.id,
        channel,
        body: body.slice(0, 2000),
        attachments,
        createdAt: new Date().toISOString(),
      };

      db.messages.push(message);
      await writeDb(db);

      const dto = messageDto(db, message);
      io.to(`room:${room.id}`).emit("message:new", dto);
      ack?.({ ok: true, message: dto });
    } catch {
      ack?.({ ok: false, message: "Unable to send the message right now." });
    }
  });

  socket.on("message:update", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const message = db.messages.find((candidate) => candidate.id === payload?.messageId);

      if (!room || !message || message.roomId !== room.id || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Message not found." });
        return;
      }

      if (message.senderId !== socket.user.id) {
        ack?.({ ok: false, message: "You can only edit your own messages." });
        return;
      }

      const body = String(payload?.body || "").trim();
      if (!body) {
        ack?.({ ok: false, message: "Message cannot be empty." });
        return;
      }

      message.body = body.slice(0, 2000);
      message.updatedAt = new Date().toISOString();
      await writeDb(db);

      const dto = messageDto(db, message);
      io.to(`room:${room.id}`).emit("message:updated", dto);
      ack?.({ ok: true, message: dto });
    } catch {
      ack?.({ ok: false, message: "Unable to edit the message right now." });
    }
  });

  socket.on("message:delete", async (payload, ack) => {
    try {
      const db = await readDb();
      const room = db.rooms.find((candidate) => candidate.id === payload?.roomId);
      const message = db.messages.find((candidate) => candidate.id === payload?.messageId);

      if (!room || !message || message.roomId !== room.id || !isMember(room, socket.user.id)) {
        ack?.({ ok: false, message: "Message not found." });
        return;
      }

      if (message.senderId !== socket.user.id) {
        ack?.({ ok: false, message: "You can only delete your own messages." });
        return;
      }

      db.messages = db.messages.filter((candidate) => candidate.id !== message.id);
      await writeDb(db);

      io.to(`room:${room.id}`).emit("message:deleted", {
        id: message.id,
        roomId: room.id,
      });
      ack?.({ ok: true, id: message.id });
    } catch {
      ack?.({ ok: false, message: "Unable to delete the message right now." });
    }
  });

  socket.on("disconnect", () => {
    removeSocketSpacePresence(socket);
    removeSocketRoomActivity(socket);
    removeSocketMeetingPresence(socket);
    clearSingleActiveUserSocket(socket);
  });
});

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get(/^\/(?!api(?:\/|$)|uploads(?:\/|$)|socket\.io(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDir, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `That file is too large. The current upload limit is ${resourceFileSizeLabel}.`,
      });
    }

    return res.status(400).json({ message: error.message || "Unable to upload that file." });
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON request." });
  }

  if (error?.status) {
    return res.status(error.status).json({ message: error.message || "Request failed." });
  }

  console.error(error);
  res.status(500).json({ message: "Something went wrong." });
});

await initDb();

server.listen(port, () => {
  console.info(
    `Diffriendtiate API running on http://127.0.0.1:${port} using ${storageMode()} storage`,
  );
  void warmChatbotOnStartup();
});
