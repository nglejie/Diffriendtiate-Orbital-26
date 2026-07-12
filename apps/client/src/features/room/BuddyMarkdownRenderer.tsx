import "streamdown/styles.css";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";

const BUDDY_STREAMDOWN_REMARK_PLUGINS = [
  ...Object.values(defaultRemarkPlugins),
  remarkMath,
];
const BUDDY_STREAMDOWN_REHYPE_PLUGINS = [
  ...Object.values(defaultRehypePlugins),
  rehypeKatex,
];

/**
 * Keeps the heavier AI-streaming markdown renderer behind a lazy boundary so
 * general room navigation does not pay for Streamdown before Intelligrate needs it.
 */
export default function BuddyMarkdownRenderer({ markdown, streaming = false }) {
  return (
    <Streamdown
      className="buddy-markdown"
      controls={false}
      mode={streaming ? "streaming" : "static"}
      normalizeHtmlIndentation
      parseIncompleteMarkdown
      rehypePlugins={BUDDY_STREAMDOWN_REHYPE_PLUGINS}
      remarkPlugins={BUDDY_STREAMDOWN_REMARK_PLUGINS}
    >
      {markdown}
    </Streamdown>
  );
}
