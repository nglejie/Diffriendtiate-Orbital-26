import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "apps/client/src/styles.css"), "utf8");
const roomViewSource = readFileSync(resolve(process.cwd(), "apps/client/src/features/room/RoomView.tsx"), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  return match?.[1] || "";
}

function cssRuleContaining(selector: string, expected: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "gm"))];
  return matches.map((match) => match[1]).find((rule) => rule.includes(expected)) || "";
}

describe("room toast styling", () => {
  it("shares toolbar surface tokens with Coordidate and Domain feedback surfaces", () => {
    expect(styles).toContain("--app-toolbar-surface: linear-gradient(");
    expect(styles).toContain("--app-toolbar-border: color-mix(in srgb, var(--text-primary) 12%, transparent)");
    expect(styles).toContain("--app-toolbar-radius: 12px");
    expect(styles).toContain("--app-toolbar-shadow:");
    expect(styles).toContain("--app-toolbar-backdrop: blur(18px) saturate(1.08)");
    expect(styles).toMatch(/\.coordinate-product-toolbar,[\s\S]*?background: var\(--app-toolbar-surface\);/);
    expect(cssRule(".room-floating-notices .form-notice")).toContain("background: var(--app-toolbar-surface)");
    expect(cssRuleContaining(".room-toast", "position: fixed")).toContain("background: var(--app-toolbar-surface)");
  });

  it("renders room-level save notices at the top center instead of inside the editor", () => {
    const noticeHostRule = cssRuleContaining(".room-floating-notices", "position: fixed");
    const noticeRule = cssRule(".room-floating-notices .form-notice");

    expect(roomViewSource).toContain('className="room-floating-notices"');
    expect(roomViewSource).toContain('className="form-notice"');
    expect(roomViewSource).toContain('setNotice("Domain updated.")');
    expect(noticeHostRule).toContain("position: fixed");
    expect(noticeHostRule).toContain("top: 18px");
    expect(noticeHostRule).toContain("right: auto");
    expect(noticeHostRule).toContain("left: 50%");
    expect(noticeHostRule).toContain("z-index: 5200");
    expect(noticeHostRule).toContain("width: min(420px, calc(100vw - 40px))");
    expect(noticeHostRule).toContain("transform: translateX(-50%)");
    expect(noticeHostRule).not.toContain("right: 18px");
    expect(noticeRule).toContain("min-height: 62px");
    expect(noticeRule).toContain("background: var(--app-toolbar-surface)");
    expect(noticeRule).toContain("border: 1px solid var(--app-toolbar-border)");
    expect(noticeRule).toContain("border-radius: var(--app-toolbar-radius)");
    expect(noticeRule).toContain("box-shadow: var(--app-toolbar-shadow)");
    expect(noticeRule).toContain("backdrop-filter: var(--app-toolbar-backdrop)");
  });

  it("renders transient Domain notices as top-centered app toolbar surfaces", () => {
    const toastRule = cssRuleContaining(".room-toast", "position: fixed");
    const iconRule = cssRule(".room-toast > svg");
    const closeRule = cssRule(".room-toast button");

    expect(roomViewSource).toContain('className="room-toast"');
    expect(roomViewSource).toContain('role="status"');
    expect(toastRule).toContain("position: fixed");
    expect(toastRule).toContain("top: 18px");
    expect(toastRule).toContain("left: 50%");
    expect(toastRule).toContain("right: auto");
    expect(toastRule).toContain("transform: translateX(-50%)");
    expect(toastRule).toContain("z-index: 5200");
    expect(toastRule).toContain("width: min(420px, calc(100vw - 40px))");
    expect(toastRule).toContain("min-height: 62px");
    expect(toastRule).toContain("background: var(--app-toolbar-surface)");
    expect(toastRule).toContain("border: 1px solid var(--app-toolbar-border)");
    expect(toastRule).toContain("border-radius: var(--app-toolbar-radius)");
    expect(toastRule).toContain("box-shadow: var(--app-toolbar-shadow)");
    expect(toastRule).toContain("backdrop-filter: var(--app-toolbar-backdrop)");
    expect(iconRule).toContain("background: color-mix(in srgb, var(--text-primary) 6%, transparent)");
    expect(iconRule).toContain("border-radius: 8px");
    expect(closeRule).toContain("border-radius: 8px");
    expect(toastRule).not.toContain("right: 18px");
  });
});
