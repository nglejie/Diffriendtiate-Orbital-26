import { useEffect, useMemo, useState } from "react";

const providerIconAliasMap: Record<string, string[]> = {
  anthropic: ["claude", "anthropic"],
  azure: ["microsoftazure", "azure"],
  bedrock: ["amazonaws", "amazon"],
  gemini: ["gemini", "googlegemini", "google"],
  google: ["google", "googlegemini"],
  openai: ["openai", "chatgpt"],
  vertex_ai: ["googlecloud", "google"],
  xai: ["xai", "grok"],
};

const lobeStaticIconBaseUrl = "https://unpkg.com/@lobehub/icons-static-svg@1.91.0/icons";

/** Presents catalog model ids without repeating the provider prefix in compact UI. */
export function formatModelLabel(model) {
  return String(model || "").replace(/^[a-z0-9._-]+\//i, "");
}

/** Converts provider names from LiteLLM into CDN-friendly icon slugs. */
function normalizeProviderIconSlug(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Builds icon URL fallbacks without hardcoding the provider catalog. LobeHub
 * covers many AI brands while Simple Icons catches common platform names.
 */
function getProviderIconCandidates(provider) {
  const providerId = String(provider?.providerId || provider?.id || "");
  const aliasCandidates = [
    ...(providerIconAliasMap[providerId] || []),
    ...(providerIconAliasMap[normalizeProviderIconSlug(providerId)] || []),
  ];
  const rawCandidates = [
    ...aliasCandidates,
    provider?.iconSlug,
    provider?.providerId,
    provider?.id,
    provider?.providerName,
    provider?.defaultLabel,
    provider?.label,
  ];
  const slugCandidates = rawCandidates.flatMap((candidate) => {
    const rawValue = String(candidate || "");
    const fullSlug = normalizeProviderIconSlug(rawValue);
    const wordSlugs = rawValue
      .split(/[^a-zA-Z0-9]+/)
      .map(normalizeProviderIconSlug)
      .filter((slug) => slug.length > 2);
    return [fullSlug, ...wordSlugs];
  });
  const slugs = [...new Set(slugCandidates.filter(Boolean))];
  return slugs.flatMap((slug) => [
    { monochrome: false, url: `${lobeStaticIconBaseUrl}/${slug}-color.svg` },
    { monochrome: false, url: `https://cdn.simpleicons.org/${slug}` },
    { monochrome: true, url: `${lobeStaticIconBaseUrl}/${slug}.svg` },
    { monochrome: true, url: `https://cdn.simpleicons.org/${slug}/ffffff` },
  ]);
}

/** Keeps provider rows usable when no public icon exists for a provider. */
function getProviderInitial(provider) {
  return String(
    provider?.providerName ||
      provider?.defaultLabel ||
      provider?.label ||
      provider?.id ||
      provider?.providerId ||
      "L",
  )
    .trim()
    .charAt(0)
    .toUpperCase() || "L";
}

/** Renders a colored provider icon with CDN fallbacks and an initial fallback. */
export function ProviderIcon({ className = "", provider }) {
  const candidates = useMemo(() => getProviderIconCandidates(provider), [provider]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const icon = candidates[candidateIndex] || null;

  useEffect(() => {
    setCandidateIndex(0);
  }, [provider?.defaultLabel, provider?.id, provider?.label, provider?.providerId, provider?.providerName]);

  return (
    <span className={["llm-provider-icon", className].filter(Boolean).join(" ")} aria-hidden="true">
      {icon?.url ? (
        <img
          alt=""
          className={icon.monochrome ? "monochrome" : ""}
          onError={() => setCandidateIndex((current) => current + 1)}
          src={icon.url}
        />
      ) : (
        <span>{getProviderInitial(provider)}</span>
      )}
    </span>
  );
}

export default ProviderIcon;
