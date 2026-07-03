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
    .replace(/([.!?])\s*(-\s+\*\*)/g, "$1\n$2")
    .replace(/([.!?])\s*(\d+\.\s+\*\*)/g, "$1\n\n$2")
    .replace(/([^\n:])\s+-\s+/g, "$1\n- ")
    .replace(/([A-Za-z)])([.!?])(?=[A-Z])/g, "$1$2 ")
    .replace(/(^|[^\n])(\s*)(\d+)\.\s+/g, (match, prefix, _space, number) =>
      prefix.trim() ? `${prefix}\n${number}. ` : `${prefix}${number}. `,
    )
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
  const toolOnlyThoughts = new Set(["search_corpus", "read_file", "sync_resources"]);

  return !toolOnlyThoughts.has(compact);
}

function getToolDisplayName(name) {
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

      if (!label && toolName === "search_corpus") {
        const query = compactToolQuery(input.query || input.reason || "");
        const sourceNames = extractSourceNames(result);

        if (status === "running") {
          label = query ? `Searching room resources for "${query}"` : "Searching room resources";
          summary = "Searching room resources";
        } else if (/no relevant documents/i.test(result)) {
          label = query
            ? `No relevant room resources were found for "${query}"`
            : "No relevant room resources were found";
          summary = "No matching room resources";
        } else if (sourceNames.length) {
          label = query
            ? `Found ${sourceNames.length} relevant room source${sourceNames.length === 1 ? "" : "s"} for "${query}": ${sourceNames.join(", ")}`
            : `Found ${sourceNames.length} relevant room source${sourceNames.length === 1 ? "" : "s"}: ${sourceNames.join(", ")}`;
          summary = `Found ${sourceNames.length} room source${sourceNames.length === 1 ? "" : "s"}`;
        } else {
          label = query
            ? `Finished searching room resources for "${query}"`
            : "Finished searching room resources";
          summary = "Searched room resources";
        }
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
  return normalizeMathGlyphs(formatBuddyResponseText(text))
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
}

export function normalizeSourceKey(value) {
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

/**
 * Indexes room resources by every stable name the chatbot might return as a
 * source citation.
 */
export function buildSourceResourceMap(resources: any[] = []) {
  const map = new Map();

  resources.forEach((resource) => {
    [resource.title, resource.originalName, resource.storageName, resource.url].forEach(
      (candidate) => {
        const key = normalizeSourceKey(candidate);
        if (key && !map.has(key)) map.set(key, resource);
      },
    );
  });

  return map;
}
