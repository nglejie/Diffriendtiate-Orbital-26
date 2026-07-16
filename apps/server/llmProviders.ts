import crypto from "node:crypto";

export const BUILT_IN_LLM_PROVIDER_ID = "intelligrate";
export const LLM_KEY_LIMIT_PER_USER = 16;

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTED_SECRET_VERSION = "v1";
const MAX_PROVIDER_MODELS = 600;

function llmError(status, message) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

/** Reads the first non-empty environment variable from a list of supported aliases. */
function readEnv(env, ...names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

/** Accepts LibreChat-style hex/base64 secrets or hashes a long passphrase to 32 bytes. */
function decodeEncryptionSecret(rawSecret) {
  const secret = String(rawSecret || "").trim();
  if (!secret) return null;

  if (/^[a-f0-9]{64}$/i.test(secret)) {
    return Buffer.from(secret, "hex");
  }

  try {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to passphrase hashing.
  }

  if (secret.length >= 32) {
    return crypto.createHash("sha256").update(secret, "utf8").digest();
  }

  return null;
}

/**
 * Resolves the key used for API-key encryption. Production must use an explicit
 * secret, while local/test environments may derive from JWT_SECRET for easy QA.
 */
export function resolveLlmEncryptionKey(env = process.env) {
  const explicitSecret = readEnv(env, "LLM_API_KEY_ENCRYPTION_KEY", "CREDS_KEY");
  const explicitKey = decodeEncryptionSecret(explicitSecret);
  if (explicitKey) return explicitKey;

  if (String(env.NODE_ENV || "").trim() !== "production") {
    const fallbackSecret = readEnv(env, "JWT_SECRET");
    if (fallbackSecret) {
      return crypto.createHash("sha256").update(fallbackSecret, "utf8").digest();
    }
  }

  throw llmError(
    503,
    "LLM API key encryption is not configured. Set LLM_API_KEY_ENCRYPTION_KEY before saving keys.",
  );
}

/** Reports whether this server can encrypt BYOK secrets without exposing why to clients. */
export function canEncryptLlmApiKeys(env = process.env) {
  try {
    resolveLlmEncryptionKey(env);
    return true;
  } catch {
    return false;
  }
}

/** Encrypts a provider key with a random IV and authentication tag for tamper checks. */
export function encryptLlmApiKey(secret, env = process.env) {
  const key = resolveLlmEncryptionKey(env);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(secret || ""), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTED_SECRET_VERSION,
    iv.toString("hex"),
    tag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/** Decrypts only the selected user's key immediately before a LiteLLM request. */
export function decryptLlmApiKey(encryptedSecret, env = process.env) {
  const [version, ivHex, tagHex, ciphertextHex] = String(encryptedSecret || "").split(":");
  if (version !== ENCRYPTED_SECRET_VERSION || !ivHex || !tagHex || !ciphertextHex) {
    throw llmError(500, "Saved LLM API key has an unsupported encryption format.");
  }

  try {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      resolveLlmEncryptionKey(env),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw llmError(500, "Saved LLM API key could not be decrypted. Save the key again.");
  }
}

/** Normalizes provider identifiers from LiteLLM and client requests into stable storage keys. */
export function normalizeLlmProviderId(value) {
  return String(value || "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/gi, "")
    .trim()
    .toLowerCase()
    .slice(0, 90);
}

/** Turns LiteLLM ids into readable labels without owning a fixed provider list. */
export function formatLlmProviderName(value) {
  const id = normalizeLlmProviderId(value);
  if (!id) return "Provider";

  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 3 && /^[a-z]+$/i.test(part)) return part.toUpperCase();
      if (part.endsWith("ai") && part.length > 2) {
        return `${part.slice(0, -2).charAt(0).toUpperCase()}${part.slice(1, -2)}AI`;
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

/** Keeps user-facing labels compact and safe to render in settings and composer chips. */
export function normalizeLlmLabel(value, fallback) {
  return String(value || fallback || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Deduplicates LiteLLM model variants while preserving enough catalog order for defaults. */
export function normalizeLlmModels(value) {
  const seen = new Set();
  const source = Array.isArray(value) ? value : [];
  const models = [];

  for (const item of source) {
    const model = String(item || "")
      .replace(/\s+/g, "")
      .trim()
      .slice(0, 180);
    if (!model || !/^[a-z0-9._:/@+-]+$/i.test(model) || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
    if (models.length >= MAX_PROVIDER_MODELS) break;
  }

  return models;
}

/** Normalizes one LiteLLM provider entry returned by the chatbot service catalog endpoint. */
function normalizeCatalogProvider(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;

  const id = normalizeLlmProviderId(record.id || record.providerId || record.provider);
  const models = normalizeLlmModels(record.models || record.variants);
  if (!id || !models.length) return null;

  const providerName = normalizeLlmLabel(
    record.providerName || record.name || record.label,
    formatLlmProviderName(id),
  );
  const requestedDefaultModel = String(record.defaultModel || "").trim();
  const defaultModel = models.includes(requestedDefaultModel) ? requestedDefaultModel : models[0];

  return {
    id,
    providerName,
    defaultLabel: normalizeLlmLabel(record.defaultLabel, providerName),
    defaultModel,
    models,
  };
}

/**
 * Converts the service-owned LiteLLM catalog into the shape consumed by routes
 * and React. The app does not hardcode providers or model variants here.
 */
export function normalizeLlmProviderCatalog(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.providers)
      ? value.providers
      : [];
  const providersById = new Map();

  for (const record of source) {
    const provider = normalizeCatalogProvider(record);
    if (provider && !providersById.has(provider.id)) {
      providersById.set(provider.id, provider);
    }
  }

  return [...providersById.values()].sort((a, b) =>
    a.providerName.localeCompare(b.providerName, undefined, { sensitivity: "base" }),
  );
}

/** Looks up a supported provider from the current service catalog. */
export function getLlmProvider(catalog, providerId) {
  const id = normalizeLlmProviderId(providerId);
  return normalizeLlmProviderCatalog(catalog).find((provider) => provider.id === id) || null;
}

/** Validates LiteLLM model strings against the selected provider's service catalog variants. */
export function normalizeLlmModel(value, provider) {
  const model = String(value || provider?.defaultModel || "")
    .replace(/\s+/g, "")
    .trim()
    .slice(0, 180);

  if (!model || !/^[a-z0-9._:/@+-]+$/i.test(model)) {
    throw llmError(400, "Enter a valid LiteLLM model string for this provider.");
  }

  const models = normalizeLlmModels(provider?.models);
  if (models.length && !models.includes(model)) {
    throw llmError(400, "Choose a model supported by this provider.");
  }

  return model;
}

/** Rejects obviously malformed secrets before encryption so plaintext never reaches storage. */
export function normalizeLlmApiSecret(value) {
  const secret = String(value || "").trim();
  if (secret.length < 8) {
    throw llmError(400, "Enter the API key for this provider.");
  }
  if (secret.length > 5000 || /[\r\n]/.test(secret)) {
    throw llmError(400, "API keys must be a single line under 5000 characters.");
  }
  return secret;
}

/** Produces a short, non-sensitive key preview for User Settings rows. */
export function previewLlmApiKey(secret) {
  const value = String(secret || "").replace(/\s+/g, "");
  if (value.length <= 8) return "Saved";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Fingerprints plaintext keys for duplicate detection without storing the secret itself. */
export function hashLlmApiKeySecret(secret) {
  return crypto.createHash("sha256").update(String(secret || ""), "utf8").digest("hex");
}

/** Normalizes one persisted key record without requiring the external catalog to be online. */
function normalizeStoredKeyRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;

  const providerId = normalizeLlmProviderId(record.providerId);
  const encryptedApiKey = String(record.encryptedApiKey || "").trim();
  const id = String(record.id || "").trim().slice(0, 80);
  const model = String(record.model || "")
    .replace(/\s+/g, "")
    .trim()
    .slice(0, 180);
  if (!providerId || !encryptedApiKey || !id || !model) return null;

  const providerName = normalizeLlmLabel(record.providerName, formatLlmProviderName(providerId));
  const createdAt = Number.isFinite(Date.parse(record.createdAt))
    ? String(record.createdAt)
    : new Date().toISOString();
  const updatedAt = Number.isFinite(Date.parse(record.updatedAt))
    ? String(record.updatedAt)
    : createdAt;

  return {
    id,
    providerId,
    providerName,
    label: normalizeLlmLabel(record.label, providerName),
    model,
    encryptedApiKey,
    keyFingerprint: String(record.keyFingerprint || "").trim().slice(0, 128),
    keyPreview: String(record.keyPreview || "Saved").trim().slice(0, 40),
    createdAt,
    updatedAt,
  };
}

/**
 * Keeps persisted BYOK records compatible across JSON/Postgres migrations while
 * preserving valid records even when the service catalog cannot be reached.
 */
export function normalizeStoredLlmApiKeys(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(normalizeStoredKeyRecord)
    .filter(Boolean)
    .slice(0, LLM_KEY_LIMIT_PER_USER);
}

export function publicLlmApiKeyDto(record, catalog = []) {
  const normalized = normalizeStoredKeyRecord(record);
  if (!normalized) return null;

  const provider = getLlmProvider(catalog, normalized.providerId);
  const providerName = provider?.providerName || normalized.providerName;

  return {
    id: normalized.id,
    providerId: normalized.providerId,
    providerName,
    label: normalizeLlmLabel(normalized.label, providerName),
    model: normalized.model,
    keyPreview: normalized.keyPreview || "Saved",
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

/** Returns only redacted key metadata to clients; encrypted secrets never leave the server. */
export function publicLlmApiKeysDto(records, catalog = []) {
  return normalizeStoredLlmApiKeys(records).map((record) => publicLlmApiKeyDto(record, catalog)).filter(Boolean);
}

/** Represents the existing in-app Intelligrate assistant as the default provider. */
export function builtInBuddyProviderOption(providerStatus) {
  const model = normalizeLlmLabel(providerStatus?.model, "Default Intelligrate model");
  return {
    id: BUILT_IN_LLM_PROVIDER_ID,
    providerId: BUILT_IN_LLM_PROVIDER_ID,
    providerName: "Intelligrate",
    label: "Intelligrate",
    model,
    builtIn: true,
    available: Boolean(providerStatus?.available),
    unavailableReason: providerStatus?.available
      ? ""
      : providerStatus?.message || "The built-in Intelligrate provider is not configured yet.",
  };
}

/**
 * Builds the per-user provider list shown in Intelligrate. BYOK providers are
 * visible once saved and enabled when the service-owned LiteLLM catalog exists.
 */
export function buildBuddyProviderOptions(user, { providerStatus, byokRoutingAvailable = true, catalog = [] }) {
  const byokProviders = normalizeStoredLlmApiKeys(user?.llmApiKeys).map((record) => {
    const publicKey = publicLlmApiKeyDto(record, catalog);
    return {
      id: publicKey.id,
      providerId: publicKey.providerId,
      providerName: publicKey.providerName,
      label: publicKey.label,
      model: publicKey.model,
      builtIn: false,
      keyPreview: publicKey.keyPreview,
      available: Boolean(byokRoutingAvailable),
      unavailableReason: byokRoutingAvailable ? "" : "LLM provider catalog is not available yet.",
    };
  });

  return [builtInBuddyProviderOption(providerStatus), ...byokProviders];
}

/** Converts a resolved provider selection into metadata persisted on assistant messages. */
export function buddyProviderMeta(selection) {
  if (!selection || selection.kind === "built-in") {
    return {
      providerKeyId: BUILT_IN_LLM_PROVIDER_ID,
      providerId: BUILT_IN_LLM_PROVIDER_ID,
      providerName: "Intelligrate",
      providerLabel: "Intelligrate",
      model: normalizeLlmLabel(selection?.providerStatus?.model, "Default Intelligrate model"),
    };
  }

  return {
    providerKeyId: selection.keyRecord.id,
    providerId: selection.provider.id,
    providerName: selection.provider.providerName,
    providerLabel: selection.keyRecord.label || selection.provider.defaultLabel,
    model: selection.keyRecord.model || selection.provider.defaultModel,
  };
}

/**
 * Resolves the requested provider for one Intelligrate message. This is the key
 * boundary that ensures members can only use their own saved BYOK records.
 */
export function resolveBuddyProviderSelection(
  user,
  providerKeyId,
  catalog = [],
  env = process.env,
  providerStatus = null,
) {
  const requestedId = String(providerKeyId || BUILT_IN_LLM_PROVIDER_ID).trim();
  if (!requestedId || requestedId === BUILT_IN_LLM_PROVIDER_ID) {
    return { kind: "built-in", providerStatus };
  }

  const keyRecord = normalizeStoredLlmApiKeys(user?.llmApiKeys).find(
    (record) => record.id === requestedId,
  );
  if (!keyRecord) {
    throw llmError(403, "Add this LLM API key in User Settings before using it.");
  }

  const provider = getLlmProvider(catalog, keyRecord.providerId);
  if (!provider) {
    throw llmError(400, "This LLM provider is not supported by the current LiteLLM catalog.");
  }
  if (!provider.models.includes(keyRecord.model)) {
    throw llmError(400, "This saved LLM model is no longer listed for the selected provider.");
  }

  return {
    kind: "byok",
    provider,
    keyRecord,
    apiKey: decryptLlmApiKey(keyRecord.encryptedApiKey, env),
  };
}
