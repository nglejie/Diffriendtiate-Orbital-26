type AnyRecord = Record<string, any>;

/**
 * Creates the client-side shape used for Intelligrate chats before or after they are
 * persisted by the API.
 */
export function createBuddyThread(title = "New Chat", id?: any, options: AnyRecord = {}) {
  return {
    id: id || `buddy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    visibility: options.visibility || "private",
    ownerId: options.ownerId || "",
    owner: options.owner || null,
    isOwner: options.isOwner ?? true,
    isDraft: Boolean(options.isDraft),
    createdAt: options.createdAt || new Date().toISOString(),
    updatedAt: options.updatedAt || new Date().toISOString(),
    messages: options.messages?.length ? options.messages : [],
  };
}

/**
 * Normalises an Intelligrate chat returned by the backend so the UI can treat local
 * draft chats and saved chats the same way.
 */
export function normalizeBuddyThread(thread: any, user?: any) {
  return createBuddyThread(thread.title || "New Chat", thread.id, {
    visibility: thread.visibility === "public" ? "public" : "private",
    ownerId: thread.ownerId || thread.owner?.id || user?.id || "",
    owner: thread.owner || null,
    isOwner: Boolean(thread.isOwner),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: thread.messages,
  });
}

/**
 * Fixes common spacing issues from model output before the markdown renderer
 * sees the answer.
 */
export function formatBuddyResponseText(value) {
  return String(value || "")
    .replace(/\$\s*\n\s*([0-9])/g, (_match, digit) => `$${digit}`)
    .replace(/(\d)\s*\n\s*\.(\d)/g, "$1.$2")
    .replace(/(^|\n)(\s*)(\d+)\.(?=\S)/g, "$1$2$3. ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const LOOSE_LATEX_SYMBOLS = {
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  epsilon: "\u03b5",
  theta: "\u03b8",
  lambda: "\u03bb",
  mu: "\u03bc",
  pi: "\u03c0",
  rho: "\u03c1",
  sigma: "\u03c3",
  tau: "\u03c4",
  phi: "\u03c6",
  omega: "\u03c9",
};

const SYMBOL_FONT_GLYPHS = {
  "\uf061": "\u03b1",
  "\uf062": "\u03b2",
  "\uf063": "\u03c7",
  "\uf064": "\u03b4",
  "\uf065": "\u03b5",
  "\uf066": "\u03c6",
  "\uf067": "\u03b3",
  "\uf06c": "\u03bb",
  "\uf06d": "\u03bc",
  "\uf070": "\u03c0",
  "\uf071": "\u03b8",
  "\uf072": "\u03c1",
  "\uf073": "\u03c3",
  "\uf077": "\u03c9",
  "\uf0d7": "\u00b7",
};

/**
 * Repairs UTF-8 characters that sometimes arrive double-decoded from parsed
 * documents.
 */
function normalizeBrokenGreekGlyphs(text) {
  const replacements = {
    "\u00ce\u00b1": "\u03b1",
    "\u00ce\u00b2": "\u03b2",
    "\u00ce\u00b3": "\u03b3",
    "\u00ce\u00b4": "\u03b4",
    "\u00ce\u00b5": "\u03b5",
    "\u00ce\u00b8": "\u03b8",
    "\u00ce\u00bb": "\u03bb",
    "\u00ce\u00bc": "\u03bc",
    "\u00cf\u0080": "\u03c0",
    "\u00cf\u0081": "\u03c1",
    "\u00cf\u0083": "\u03c3",
    "\u00cf\u0084": "\u03c4",
    "\u00cf\u0086": "\u03c6",
    "\u00cf\u0087": "\u03c7",
    "\u00cf\u0089": "\u03c9",
    "\u00c2\u00b7": "\u00b7",
  };

  let cleaned = String(text || "");
  Object.entries(replacements).forEach(([broken, fixed]) => {
    cleaned = cleaned.replaceAll(broken, fixed);
  });
  return cleaned;
}

/**
 * Converts loose LaTeX names and symbol-font glyphs into readable characters
 * before rendering the final Intelligrate answer.
 */
export function normalizeMathGlyphs(text) {
  let cleaned = String(text || "").replace(/\\{1,2}([A-Za-z]+)\b/g, (match, name) => {
    return LOOSE_LATEX_SYMBOLS[name] || match;
  });

  Object.entries(SYMBOL_FONT_GLYPHS).forEach(([broken, replacement]) => {
    cleaned = cleaned.replaceAll(broken, replacement);
  });

  return normalizeBrokenGreekGlyphs(cleaned);
}

/**
 * Pulls readable text out of streamed payloads, tool events, arrays, and
 * server objects without leaking `[object Object]` into the UI.
 */
export function getBuddyDisplayText(value) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(getBuddyDisplayText).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    const directText =
      value.text ??
      value.message ??
      value.summary ??
      value.content ??
      value.output ??
      value.detail ??
      value.description ??
      "";

    if (directText && directText !== value) {
      return getBuddyDisplayText(directText);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value || "").trim();
}

/**
 * Creates one visible progress item for Intelligrate's streamed thought/tool timeline.
 */
export function createBuddyThoughtItem(type: any, text: any, options: AnyRecord = {}) {
  const cleanedText = getBuddyDisplayText(text);

  return {
    id: options.id || `${type}:${options.tool || ""}:${cleanedText}`,
    type,
    text: cleanedText,
    summary: getBuddyDisplayText(options.summary),
    tool: options.tool || "",
    status: options.status || "",
    sourceType: options.sourceType || "",
  };
}

/**
 * Converts older string-based progress rows and newer object-based rows into
 * the same timeline item shape.
 */
export function normalizeBuddyThoughtItem(step: any) {
  if (step && typeof step === "object") {
    return createBuddyThoughtItem(step.type || "thought", getBuddyDisplayText(step), step);
  }

  const text = getBuddyDisplayText(step);
  if (text === "[object Object]") {
    return createBuddyThoughtItem("thought", "", { id: "invalid-object-step" });
  }

  return createBuddyThoughtItem(text === "Done" ? "done" : "thought", text, {
    id: text === "Done" ? "done" : undefined,
  });
}

/**
 * Deduplicates timeline rows so repeated stream chunks update the same row
 * instead of creating visual noise.
 */
export function uniqueBuddySteps(steps) {
  const seen = new Set();

  return steps
    .map(normalizeBuddyThoughtItem)
    .filter((step) => step.text)
    .filter((step) => {
      const key = step.id || `${step.type}:${step.tool}:${step.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Merges incoming thought/tool stream chunks into the existing message state.
 */
export function mergeBuddyThoughtSteps(currentSteps, nextSteps) {
  const merged = uniqueBuddySteps(currentSteps);

  uniqueBuddySteps(Array.isArray(nextSteps) ? nextSteps : [nextSteps]).forEach((nextStep) => {
    const existingIndex = merged.findIndex((step) => step.id === nextStep.id);
    const duplicateThoughtIndex =
      existingIndex < 0 && nextStep.type === "thought"
        ? merged.findIndex(
          (step) =>
            step.type === "thought" &&
            compactBuddyText(step.text) === compactBuddyText(nextStep.text),
        )
        : -1;
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...nextStep };
      return;
    }
    if (duplicateThoughtIndex >= 0) {
      merged[duplicateThoughtIndex] = { ...merged[duplicateThoughtIndex], ...nextStep };
      return;
    }
    merged.push(nextStep);
  });

  return uniqueBuddySteps(merged);
}

/**
 * Finds the final assistant answer from the returned chain payload when the
 * streaming API does not send a separate answer field.
 */
export function getBuddyChainFinalAnswer(chain) {
  return getBuddyChainFinalVisibleResponse(chain).answer;
}

/**
 * Returns the final assistant chain content split into tagged model thoughts and
 * answer text. Untagged assistant text stays in chronological message order so
 * the UI can decide whether it appeared before or after a tool event.
 */
export function getBuddyChainFinalVisibleResponse(chain) {
  if (!Array.isArray(chain)) return { answer: "", thoughts: [] };

  const lastUserIndex = chain.reduce(
    (last, item, index) => (item?.role === "user" ? index : last),
    -1,
  );

  for (const item of chain.slice(lastUserIndex + 1).reverse()) {
    if (item?.role !== "assistant") continue;
    const content = splitBuddyVisibleThinking(String(item.content || "").trim());
    const answer = content.answer.trim();
    if (answer.startsWith("[TRACE]")) continue;
    if (answer || content.thoughts.length) {
      return {
        answer,
        thoughts: content.thoughts,
      };
    }
  }

  return { answer: "", thoughts: [] };
}

/** Collapses text to one line for comparison and summaries. */
export function compactBuddyText(value) {
  return getBuddyDisplayText(value).replace(/\s+/g, " ").trim();
}

/**
 * Removes raw `<thinking>` tags when they arrive in partial streamed chunks.
 */
export function cleanBuddyThinkingArtifacts(text) {
  return String(text || "")
    .replace(/<\/?\s*(?:think|thinking)\s*>/gi, "")
    .replace(/^\s*(?:think|thinking)\s*>\s*/i, "")
    .replace(/<\s*\/?\s*(?:think|thinking)?\s*$/i, "")
    .trim();
}

/**
 * Separates visible model reasoning from the final answer when Intelligrate returns
 * `<thinking>...</thinking>` blocks.
 */
export function splitBuddyVisibleThinking(rawText) {
  const raw = String(rawText || "");
  const thoughts = [];
  let answer = "";
  let cursor = 0;
  const openTag = /<(?:think|thinking)>/gi;

  while (cursor < raw.length) {
    openTag.lastIndex = cursor;
    const start = openTag.exec(raw);

    if (!start) {
      answer += raw.slice(cursor);
      break;
    }

    answer += raw.slice(cursor, start.index);
    const closeTag = /<\/(?:think|thinking)>/gi;
    closeTag.lastIndex = openTag.lastIndex;
    const end = closeTag.exec(raw);

    if (!end) {
      thoughts.push(raw.slice(openTag.lastIndex));
      break;
    }

    thoughts.push(raw.slice(openTag.lastIndex, end.index));
    cursor = closeTag.lastIndex;
  }

  return {
    answer: cleanBuddyThinkingArtifacts(answer.replace(/^\s+/, "")),
    thoughts: thoughts.map(cleanBuddyThinkingArtifacts).filter(isUsefulBuddyThought),
  };
}

function isUsefulBuddyThought(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return false;

  const compact = cleaned.toLowerCase().replace(/[\s_-]+/g, "_");
  const toolOnlyThoughts = new Set(["search_domain_context", "search_corpus", "read_file", "sync_resources"]);

  return !toolOnlyThoughts.has(compact);
}

function getToolDisplayName(name) {
  if (name === "search_domain_context") return "Search Domain context";
  if (name === "search_corpus") return "Search room resources";
  if (name === "read_file") return "Read uploaded file";
  if (name === "embed_room_documents") return "Sync room resources";
  if (name === "sync_resources") return "Sync room resources";

  const cleanedName = String(name || "tool")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanedName
    ? `${cleanedName.charAt(0).toUpperCase()}${cleanedName.slice(1)}`
    : "Tool";
}

function normalizeToolSourceType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (["infilenite", "file", "files", "resource", "resources", "attachment", "attachments"].includes(text)) {
    return "resource";
  }
  if (["convolution", "chat", "channel", "channels", "message", "messages", "discussion", "discussions"].includes(text)) {
    return "convolution_message";
  }
  if (["coordidate", "calendar", "meeting", "meetings", "event", "events", "session", "sessions", "deadline", "deadlines"].includes(text)) {
    return "coordidate_session";
  }
  if (["poll", "polls", "availability"].includes(text)) return "coordidate_poll";
  if (["annotation", "annotations"].includes(text)) return "annotation";
  return text;
}

function inferToolSourceType(input: AnyRecord = {}) {
  const explicit = normalizeToolSourceType(input.source_type || input.sourceType);
  if (explicit) return explicit;

  const query = compactBuddyText(input.query || input.reason || "").toLowerCase();
  const matches = [];
  if (/\b(infilenite|resource|resources|file|files|attachment|attachments)\b/.test(query)) matches.push("resource");
  if (/\b(convolution|channel|channels|message|messages|discussion|discussions|chat)\b/.test(query)) matches.push("convolution_message");
  if (/\b(annotation|annotations|comment|comments)\b/.test(query)) matches.push("annotation");
  if (/\b(coordidate|calendar|meeting|meetings|event|events|schedule|schedules|deadline|deadlines|availability)\b/.test(query)) {
    matches.push("coordidate_session");
  }
  const uniqueMatches = [...new Set(matches)];
  return uniqueMatches.length === 1 ? uniqueMatches[0] : "";
}

function getToolScopeLabel(input: AnyRecord = {}) {
  const sourceType = inferToolSourceType(input);
  if (sourceType === "resource") return "Infilenite";
  if (sourceType === "convolution_message") {
    return input.channel ? `Convolution #${input.channel}` : "Convolution";
  }
  if (sourceType === "annotation") return "annotations";
  if (sourceType === "coordidate_session" || sourceType === "coordidate_poll") return "Coordidate";
  return "Domain context";
}

function getTemporalSearchPrefix(input: AnyRecord = {}) {
  const timeframe = String(input.timeframe || "").trim().toLowerCase();
  if (["upcoming", "future"].includes(timeframe)) return "upcoming ";
  if (["past", "previous"].includes(timeframe)) return "past ";
  const query = compactBuddyText(input.query || input.reason || "").toLowerCase();
  if (/\b(upcoming|coming up|future|next|later|scheduled)\b/.test(query)) return "upcoming ";
  if (/\b(past|previous|earlier|old|last)\b/.test(query)) return "past ";
  return "";
}

function getNoMatchScopeLabel(scopeLabel) {
  return /\bcontext$/i.test(scopeLabel) ? scopeLabel : `${scopeLabel} context`;
}

function getEventDisplayLabel(event: AnyRecord, fallback: string) {
  return (
    getBuddyDisplayText(event.display) ||
    getBuddyDisplayText(event.label) ||
    getBuddyDisplayText(event.summary) ||
    getBuddyDisplayText(event.message) ||
    fallback
  );
}

function firstAvailableAttachmentName(options: AnyRecord = {}) {
  const attachment = Array.isArray(options.attachments) ? options.attachments[0] : null;
  return attachment?.title || attachment?.name || attachment?.originalName || "";
}

function extractSourceNames(text) {
  const sources = [];
  const pattern = /\[Source:\s*([^\]\n]+)\]/gi;
  const haystack = String(text || "");
  let match = pattern.exec(haystack);

  while (match) {
    const source = match[1].trim();
    if (source && !sources.includes(source)) sources.push(source);
    match = pattern.exec(haystack);
  }

  return sources;
}

function compactToolQuery(value) {
  const query = compactBuddyText(value).replace(/^["']|["']$/g, "");
  return query.length > 100 ? `${query.slice(0, 100).trim()}...` : query;
}

/**
 * Converts raw TOOL_START / TOOL_END stream payloads into timeline rows that
 * the frontend can render without knowing chatbot internals. Each tool keeps
 * its own wording so the UI does not blur separate events such as searching the
 * room corpus and reading an uploaded file.
 */
export function formatBuddyToolEvent(rawEvent: any, options: AnyRecord = {}) {
  try {
    const wrapper =
      rawEvent && typeof rawEvent === "object" && rawEvent.payload !== undefined
        ? rawEvent
        : null;
    const event = wrapper
      ? typeof wrapper.payload === "string"
        ? JSON.parse(wrapper.payload || "{}")
        : wrapper.payload || {}
      : typeof rawEvent === "string"
        ? JSON.parse(rawEvent || "{}")
        : rawEvent && typeof rawEvent === "object"
          ? rawEvent
          : {};
    const eventName = wrapper?.event || event.event || "";
    const toolName = event.tool || event.name;
    const input = event.input || event.args || {};
    const result = getBuddyDisplayText(event.result || event.output || "");
    const status =
      event.status ||
      (eventName === "tool_start" ? "running" : eventName === "tool_end" ? "done" : "");
    const toolId = event.id || `${toolName || "tool"}:${JSON.stringify(input)}`;

    if (!toolName) {
      const label = getEventDisplayLabel(event, "");
      if (label) {
        return createBuddyThoughtItem(event.type || "thought", label, {
          id: event.id || `${event.type || "thought"}:${label}`,
          status: event.status || "",
          summary: event.summary || label,
        });
      }
    }

    if (toolName) {
      let label = getEventDisplayLabel(event, "");
      let summary = getToolDisplayName(toolName);

      if (!label && ["search_domain_context", "search_corpus"].includes(toolName)) {
        const query = compactToolQuery(input.query || input.reason || "");
        const sourceNames = extractSourceNames(result);
        const sourceType = inferToolSourceType(input);
        const scopeLabel = getToolScopeLabel(input);
        const temporalPrefix = getTemporalSearchPrefix(input);
        const scopedObject = `${temporalPrefix}${scopeLabel}`.trim();

        if (status === "running") {
          label = query ? `Searching ${scopedObject} for "${query}"` : `Searching ${scopedObject}`;
          summary = `Searching ${scopeLabel}`;
        } else if (/no relevant (?:documents|domain sources|domain context)/i.test(result)) {
          const noMatchScope = getNoMatchScopeLabel(scopeLabel);
          label = query
            ? `No relevant ${noMatchScope} was found for "${query}"`
            : `No relevant ${noMatchScope} was found`;
          summary = `No matching ${scopeLabel}`;
        } else if (sourceNames.length) {
          label = query
            ? `Found ${sourceNames.length} relevant ${scopeLabel} source${sourceNames.length === 1 ? "" : "s"} for "${query}": ${sourceNames.join(", ")}`
            : `Found ${sourceNames.length} relevant ${scopeLabel} source${sourceNames.length === 1 ? "" : "s"}: ${sourceNames.join(", ")}`;
          summary = `Found ${sourceNames.length} ${scopeLabel} source${sourceNames.length === 1 ? "" : "s"}`;
        } else {
          label = query
            ? `Finished searching ${scopeLabel} for "${query}"`
            : `Finished searching ${scopeLabel}`;
          summary = `Searched ${scopeLabel}`;
        }
        return createBuddyThoughtItem("tool", label, {
          id: `${toolId}:${status}:${compactBuddyText(label || summary).slice(0, 180)}`,
          sourceType,
          status,
          summary,
          tool: toolName,
        });
      }

      if (!label && toolName === "read_file") {
        const fileName =
          input.file_name ||
          input.fileName ||
          input.name ||
          firstAvailableAttachmentName(options);
        const reason = compactToolQuery(input.reason || "");

        if (status === "running") {
          label = fileName
            ? `Reading the uploaded document: ${fileName}`
            : "Reading the uploaded document";
          if (reason) label += ` to ${reason}`;
          summary = "Reading uploaded document";
        } else {
          label = fileName
            ? `Finished reading the uploaded document: ${fileName}`
            : "Finished reading the uploaded document";
          summary = "Read uploaded document";
        }
      }

      if (!label && ["embed_room_documents", "sync_resources"].includes(toolName)) {
        label =
          status === "done"
            ? "Finished syncing room resources"
            : "Syncing room resources";
        summary = "Sync room resources";
      }

      if (!label) {
        label = status === "done"
          ? `Finished ${getToolDisplayName(toolName).toLowerCase()}`
          : getToolDisplayName(toolName);
      }

      // Include the display label in the timeline identity. Some chatbot streams
      // reuse the same tool id across multiple calls, so id+status alone can
      // accidentally replace earlier searches with later ones.
      const displayIdentity = compactBuddyText(label || summary).slice(0, 180);

      return createBuddyThoughtItem("tool", label, {
        id: `${toolId}:${status}:${displayIdentity}`,
        tool: toolName,
        status,
        summary,
      });
    }
  } catch {
    return createBuddyThoughtItem("thought", getBuddyDisplayText(rawEvent));
  }

  return createBuddyThoughtItem("thought", getBuddyDisplayText(rawEvent));
}

/**
 * Builds the one-line summary shown when an Intelligrate progress chain is collapsed.
 */
export function getBuddyThoughtSummary(message: any) {
  const steps = uniqueBuddySteps(message.thinkingSteps || []);
  const firstThought = steps.find((step) => step.type === "thought" && step.text);
  const lastThought = [...steps].reverse().find((step) => step.type === "thought" && step.text);
  const lastTool = [...steps].reverse().find((step) => step.type === "tool" && step.text);

  if (message.isThinking) {
    return "Intelligrate is working hard on your request";
  }

  if (steps.length) {
    return "Intelligrate has finished processing your request";
  }

  const searchedWithoutMatch = steps.some(
    (step) =>
      step.tool === "search_corpus" &&
      /no relevant|no matching|not found/i.test(step.text || step.summary || ""),
  );
  if (searchedWithoutMatch) return "Answered from general knowledge";

  if (lastTool?.summary) return lastTool.summary;
  if (lastTool?.text) return `Completed after ${lastTool.text.toLowerCase()}`;
  return lastThought?.summary || firstThought?.summary || "Answered directly";
}

/**
 * Normalises markdown and LaTeX markers so Intelligrate's response reads cleanly in
 * the chat view.
 */
export function normalizeBuddyMarkdown(text) {
  const normalized = cleanBuddyMarkdownArtifacts(normalizeMathGlyphs(formatBuddyResponseText(text)))
    .replace(/\\(#{1,6})/g, "$1")
    .replace(/(^|\n)[ \t]+(#{1,6}\s+)/g, "$1$2")
    .replace(/(^|\n)\s*\d+\.\s*(#{1,6}\s+)/g, "$1$2")
    .replace(/([^\n])\s+(#{1,6}\s+)/g, "$1\n\n$2")
    .replace(/(^|\n)(#{1,6}\s*[^\n]+?)\s*:\s*/g, "$1$2\n\n")
    .replace(/(^|\n)([A-Z][A-Za-z0-9\- /()]{2,70}:)(?=\s*\S)/g, "$1**$2**\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\\\\\[/g, () => "$$")
    .replace(/\\\\\]/g, () => "$$")
    .replace(/\\\[/g, () => "$$")
    .replace(/\\\]/g, () => "$$")
    .replace(/\\\\\(/g, () => "$")
    .replace(/\\\\\)/g, () => "$")
    .replace(/\\\(/g, () => "$")
    .replace(/\\\)/g, () => "$");

  return cleanBuddyMarkdownArtifacts(normalized).trim();
}

const BUDDY_TOOL_CALL_NAMES = new Set([
  "search_corpus",
  "search_domain_context",
  "read_file",
  "embed_room_documents",
  "sync_resources",
]);

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeToolCallInput(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed && typeof parsed === "object") return parsed;
    return { query: value };
  }
  if (typeof value === "object") return value;
  return { value };
}

function normalizeLeakedToolCall(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const functionCall = value.function_call || value.functionCall || value.function || {};
  const toolName = String(
    value.action || value.tool || value.name || functionCall.name || "",
  ).trim();
  if (!BUDDY_TOOL_CALL_NAMES.has(toolName)) return null;

  const input = normalizeToolCallInput(
    value.action_input ??
      value.actionInput ??
      value.input ??
      value.args ??
      value.arguments ??
      functionCall.arguments ??
      {},
  );

  return {
    event: "tool_start",
    tool: toolName,
    input,
    status: "running",
  };
}

function findJsonObjectSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: index + 1, text: text.slice(start, index + 1) });
        start = -1;
      }
    }
  }

  return spans;
}

function tidyExtractedToolText(text) {
  return String(text || "")
    .replace(/^[ \t]*(?:Self-correction:\s*)?$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Defensively separates provider-leaked tool-call objects from answer prose.
 * Real tool execution must still come from backend tool events; this only keeps
 * malformed model text from rendering as a final answer while preserving an
 * honest progress row for the attempted tool call.
 */
export function extractBuddyToolCallsFromText(text) {
  const raw = String(text || "");
  if (!raw.includes("{") || !raw.includes("}")) {
    const cleaned = tidyExtractedToolText(raw);
    return { text: cleaned, preToolText: "", postToolText: cleaned, toolCalls: [] };
  }

  const acceptedSpans = findJsonObjectSpans(raw)
    .map((span) => {
      const call = normalizeLeakedToolCall(tryParseJson(span.text));
      return call ? { ...span, call } : null;
    })
    .filter(Boolean);

  if (!acceptedSpans.length) {
    const cleaned = tidyExtractedToolText(raw);
    return { text: cleaned, preToolText: "", postToolText: cleaned, toolCalls: [] };
  }

  const firstSpan = acceptedSpans[0];
  const lastSpan = acceptedSpans[acceptedSpans.length - 1];
  let cleaned = raw;

  [...acceptedSpans].reverse().forEach((span) => {
    cleaned = `${cleaned.slice(0, span.start)}${cleaned.slice(span.end)}`;
  });

  return {
    text: tidyExtractedToolText(cleaned),
    preToolText: tidyExtractedToolText(raw.slice(0, firstSpan.start)),
    postToolText: tidyExtractedToolText(raw.slice(lastSpan.end)),
    toolCalls: acceptedSpans.map((span) => span.call),
  };
}

function visibleMarkdownLine(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
}

function isMarkdownSeparatorArtifact(line) {
  const visible = visibleMarkdownLine(line);
  if (!visible) return false;

  // These lines are transport/retrieval separators, not meaningful prose or
  // markdown. Filtering them before the renderer prevents empty-looking
  // paragraphs or orphan list markers without touching fenced code blocks.
  return /^[.\u3002\uFF0E\u00B7*\-_•]+$/u.test(visible);
}

function isStandaloneSourceCitationArtifact(line) {
  const visible = visibleMarkdownLine(line)
    .replace(/^\s*[-*]\s+/, "")
    .replace(/[.;]\s*$/, "")
    .trim();
  if (!visible) return false;

  return /^(?:\(?\s*source(?:s)?\s*:\s*[^)\]\n]+\s*\)?|\[\s*source(?:s)?\s*:\s*[^\]\n]+\s*\])$/i.test(visible);
}

function stripTrailingSourceCitationArtifact(line) {
  return String(line || "")
    .replace(/\s*\((?:source|sources)\s*:\s*[^)\n]+\)\s*$/i, "")
    .replace(/\s*\[(?:source|sources)\s*:\s*[^\]\n]+\]\s*$/i, "");
}

/**
 * Removes structural noise from model/retrieval output before markdown parsing.
 * The cleanup is intentionally line-oriented so real prose and code fences are
 * preserved while separator-only and standalone citation artifact lines are
 * discarded. Source chips remain the authoritative navigation affordance.
 */
export function cleanBuddyMarkdownArtifacts(markdown) {
  const lines = String(markdown || "").split("\n");
  let inFence = false;

  return lines
    .reduce((cleanedLines, line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        cleanedLines.push(line);
        return cleanedLines;
      }
      if (!inFence && (isMarkdownSeparatorArtifact(line) || isStandaloneSourceCitationArtifact(line))) {
        return cleanedLines;
      }
      cleanedLines.push(inFence ? line : stripTrailingSourceCitationArtifact(line));
      return cleanedLines;
    }, [] as string[])
    .join("\n");
}

export function normalizeSourceKey(value) {
  if (value && typeof value === "object") {
    return normalizeSourceKey(
      value.resourceId ||
        value.messageId ||
        value.annotationId ||
        value.sessionId ||
        value.pollId ||
        value.label ||
        value.sourceId ||
        "",
    );
  }

  const cleaned = String(value || "").trim();
  if (!cleaned) return "";

  const isPathLike = /^[a-z][a-z0-9+.-]*:/i.test(cleaned) || cleaned.includes("/") || cleaned.includes("\\");
  const isFileLike = /\.[a-z0-9]{2,8}(?:[?#]|$)/i.test(cleaned);
  const withoutQuery = isPathLike || isFileLike ? cleaned.split(/[?#]/)[0] : cleaned;
  const fileName = withoutQuery.split(/[\\/]/).pop() || withoutQuery;

  try {
    return decodeURIComponent(fileName).toLowerCase();
  } catch {
    return fileName.toLowerCase();
  }
}

export function isStructuredBuddySource(source) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source));
}

export function getBuddySourceLabel(source) {
  if (!isStructuredBuddySource(source)) return String(source || "").trim();
  return String(source.label || source.title || source.name || source.sourceId || "Domain source").trim();
}

export function getBuddySourceIdentity(source) {
  if (!isStructuredBuddySource(source)) return normalizeSourceKey(source);
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
  ]
    .map((part) => String(part || ""))
    .join("|")
    .toLowerCase();
}

function normalizeBuddyPdfRect(rect) {
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

function normalizeBuddyPdfHighlightPosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)) return undefined;

  const boundingRect = normalizeBuddyPdfRect(position.boundingRect || position.bounding_rect);
  const rects = (Array.isArray(position.rects) ? position.rects : [])
    .map(normalizeBuddyPdfRect)
    .filter(Boolean)
    .slice(0, 24);

  if (!boundingRect || !rects.length) return undefined;
  return { boundingRect, rects };
}

function normalizeBuddySource(source) {
  if (!isStructuredBuddySource(source)) {
    const label = String(source || "").trim();
    return label ? label : null;
  }

  const label = getBuddySourceLabel(source);
  const type = String(source.type || "").trim();
  if (!label || !type) return null;
  return {
    ...source,
    type,
    label,
    highlightPosition: normalizeBuddyPdfHighlightPosition(source.highlightPosition || source.highlight_position),
  };
}

function sourcePageNumber(source) {
  const value = Number(source?.pageNumber || source?.page || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Indexes room resources by every stable name the chatbot might return as a
 * source citation.
 */
export function buildSourceResourceMap(resources: any[] = []) {
  const map = new Map();

  resources.forEach((resource) => {
    [resource.id, resource.title, resource.originalName, resource.storageName, resource.url].forEach(
      (candidate) => {
        const key = normalizeSourceKey(candidate);
        if (key && !map.has(key)) map.set(key, resource);
      },
    );
  });

  return map;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getResourceSourceCandidates(resource) {
  const candidates = [];
  [resource?.title, resource?.originalName, resource?.storageName, resource?.url].forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;

    const withoutQuery = raw.split(/[?#]/)[0];
    const fileName = withoutQuery.split(/[\\/]/).pop() || withoutQuery;
    [raw, fileName].forEach((candidate) => {
      const trimmed = candidate.trim();
      if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
    });
  });

  return candidates.filter((candidate) => {
    if (/\.[a-z0-9]{2,8}$/i.test(candidate)) return true;
    return candidate.length >= 8;
  });
}

function findResourceForBuddySourceCandidate(source, resources: any[] = []) {
  const sourceResourceId = String(source?.resourceId || source?.sourceId || "").trim();
  const sourceLabelKey = normalizeSourceKey(getBuddySourceLabel(source));
  const sourceKey = normalizeSourceKey(source);

  return resources.find((resource) => {
    if (sourceResourceId && resource?.id === sourceResourceId) return true;

    const resourceKeys = [resource?.id, resource?.title, resource?.originalName, resource?.storageName, resource?.url]
      .map(normalizeSourceKey)
      .filter(Boolean);

    return resourceKeys.some((key) => key === sourceLabelKey || key === sourceKey);
  });
}

function sourceCitationNames(source, resource) {
  const names = [
    getBuddySourceLabel(source),
    source?.title,
    source?.name,
    source?.sourceId,
    resource?.title,
    resource?.originalName,
    resource?.storageName,
    resource?.url,
  ];

  return Array.from(
    new Set(
      names
        .flatMap((value) => getResourceSourceCandidates({ title: value, originalName: value, storageName: value, url: value }))
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function textSegmentsForPageInference(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function extractPageNumberFromSegment(segment) {
  const match = String(segment || "").match(/\b(?:p\.?|page|pages)\s*(?:#\s*)?(\d{1,4})\b/i);
  if (!match) return 0;
  const pageNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 0;
}

function inferMentionedPageNumberForSource(source, text, resources: any[] = []) {
  const resource = findResourceForBuddySourceCandidate(source, resources);
  const names = sourceCitationNames(source, resource);
  if (!names.length) return 0;

  const matchingSegment = textSegmentsForPageInference(text).find((segment) => {
    if (!extractPageNumberFromSegment(segment)) return false;
    return names.some((name) => {
      const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(name)}(?=$|[^A-Za-z0-9])`, "i");
      return pattern.test(segment);
    });
  });

  return extractPageNumberFromSegment(matchingSegment);
}

function inferPageNumberForSource(source, text, resources: any[] = []) {
  if (sourcePageNumber(source)) return sourcePageNumber(source);
  return inferMentionedPageNumberForSource(source, text, resources);
}

function hasPdfHighlightPosition(source) {
  return Boolean(
    isStructuredBuddySource(source) &&
      source.highlightPosition?.boundingRect &&
      Array.isArray(source.highlightPosition?.rects) &&
      source.highlightPosition.rects.length,
  );
}

function sourceNavigationScore(source, text, resources: any[] = []) {
  if (!source) return 0;

  const structured = isStructuredBuddySource(source);
  if (!structured) return 1;

  const pageNumber = sourcePageNumber(source);
  const mentionedPageNumber = inferMentionedPageNumberForSource(source, text, resources);
  const sourceScore = Number(source.score);
  let score = 100;

  if (source.resourceId || source.messageId || source.annotationId || source.sessionId || source.pollId) score += 20;
  if (pageNumber) score += 10;
  if (mentionedPageNumber && pageNumber === mentionedPageNumber) score += 80;
  if (hasPdfHighlightPosition(source)) score += 120;
  if (source.textQuote || source.snippet) score += 5;
  if (Number.isFinite(sourceScore)) score += Math.max(0, Math.min(10, sourceScore * 10));

  return score;
}

function enrichBuddySourceForNavigation(source, text, resources: any[] = []) {
  const pageNumber = inferPageNumberForSource(source, text, resources);
  const resource = findResourceForBuddySourceCandidate(source, resources);

  if (!pageNumber && !isStructuredBuddySource(source)) return source;

  if (resource && (!isStructuredBuddySource(source) || source.type === "resource")) {
    return {
      ...(isStructuredBuddySource(source) ? source : {}),
      type: "resource",
      label: getBuddySourceLabel(source) || resource.title || resource.originalName || "Domain source",
      resourceId: source?.resourceId || source?.sourceId || resource.id,
      pageNumber: pageNumber || sourcePageNumber(source) || undefined,
    };
  }

  if (pageNumber && isStructuredBuddySource(source) && (source.type === "resource" || !source.type)) {
    return {
      ...source,
      pageNumber,
    };
  }

  return source;
}

/**
 * Falls back to answer-text resource mentions when the stream did not include a
 * separate `sources` event. This keeps source pills tied to actual known Domain
 * resources without inventing citations.
 */
export function inferMentionedBuddySources(text, resources: any[] = []) {
  const haystack = String(text || "");
  if (!haystack.trim() || !Array.isArray(resources) || !resources.length) return [];
  const negativeEvidencePattern =
    /\b(?:no\s+(?:specific\s+)?(?:mention|information|relevant|matching|result|source)|not found|cannot find|could not find|couldn't find|unable to find|does not mention|do not mention)\b/i;
  if (negativeEvidencePattern.test(haystack)) return [];

  const found = [];
  resources.forEach((resource) => {
    const candidate = getResourceSourceCandidates(resource).find((sourceName) => {
      const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(sourceName)}(?=$|[^A-Za-z0-9])`, "i");
      return pattern.test(haystack);
    });

    if (candidate && !found.some((source) => normalizeSourceKey(source) === normalizeSourceKey(candidate))) {
      found.push(candidate);
    }
  });

  return found;
}

/**
 * Combines backend-provided source names with resource names that are visibly
 * cited in the answer text, preserving explicit stream payloads first.
 */
export function mergeBuddySources(explicitSources: any[] = [], text = "", resources: any[] = []) {
  const merged = [];
  [...(Array.isArray(explicitSources) ? explicitSources : []), ...inferMentionedBuddySources(text, resources)]
    .map(normalizeBuddySource)
    .map((source) => enrichBuddySourceForNavigation(source, text, resources))
    .filter(Boolean)
    .forEach((source) => {
      const key = getBuddySourceIdentity(source);
      const labelKey = normalizeSourceKey(getBuddySourceLabel(source));
      const duplicateIndex = merged.findIndex(
        (existing) =>
          getBuddySourceIdentity(existing) === key ||
          normalizeSourceKey(getBuddySourceLabel(existing)) === labelKey,
      );
      if (duplicateIndex < 0) {
        merged.push(source);
        return;
      }

      if (
        sourceNavigationScore(source, text, resources) >
        sourceNavigationScore(merged[duplicateIndex], text, resources)
      ) {
        merged[duplicateIndex] = source;
      }
    });

  return merged;
}
