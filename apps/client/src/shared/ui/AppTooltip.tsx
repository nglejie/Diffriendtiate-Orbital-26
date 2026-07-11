import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

type TooltipState = {
  arrowX: number;
  arrowY: number;
  label: string;
  left: number;
  placement: TooltipPlacement;
  target: HTMLElement;
  top: number;
};

const TOOLTIP_MARGIN = 10;
const TOOLTIP_GAP = 10;
const TOOLTIP_ARROW = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function estimateTooltipSize(label: string) {
  const width = clamp(label.length * 7.4 + 24, 42, Math.min(260, window.innerWidth - TOOLTIP_MARGIN * 2));
  return {
    height: 32,
    width,
  };
}

function preferredPlacement(target: HTMLElement): TooltipPlacement {
  const explicitPlacement = target.dataset.tooltipPlacement;
  if (explicitPlacement === "top" || explicitPlacement === "bottom" || explicitPlacement === "left" || explicitPlacement === "right") {
    return explicitPlacement;
  }

  if (target.closest(".room-icon-rail")) return "right";
  if (target.closest(".limeets-gather-controls")) return "left";
  if (target.closest(".document-channel-header-actions")) return "bottom";
  if (target.closest(".document-annotation-thread-header")) return "bottom";
  return "top";
}

function getCandidatePosition(
  rect: DOMRect,
  size: { height: number; width: number },
  placement: TooltipPlacement,
) {
  if (placement === "bottom") {
    return {
      left: rect.left + rect.width / 2 - size.width / 2,
      top: rect.bottom + TOOLTIP_GAP,
    };
  }
  if (placement === "left") {
    return {
      left: rect.left - size.width - TOOLTIP_GAP,
      top: rect.top + rect.height / 2 - size.height / 2,
    };
  }
  if (placement === "right") {
    return {
      left: rect.right + TOOLTIP_GAP,
      top: rect.top + rect.height / 2 - size.height / 2,
    };
  }
  return {
    left: rect.left + rect.width / 2 - size.width / 2,
    top: rect.top - size.height - TOOLTIP_GAP,
  };
}

function fitsViewport(position: { left: number; top: number }, size: { height: number; width: number }) {
  return (
    position.left >= TOOLTIP_MARGIN &&
    position.top >= TOOLTIP_MARGIN &&
    position.left + size.width <= window.innerWidth - TOOLTIP_MARGIN &&
    position.top + size.height <= window.innerHeight - TOOLTIP_MARGIN
  );
}

function choosePlacement(
  rect: DOMRect,
  size: { height: number; width: number },
  placement: TooltipPlacement,
): TooltipPlacement {
  const candidates =
    placement === "left" || placement === "right"
      ? [placement, placement === "left" ? "right" : "left", "top", "bottom"]
      : [placement, placement === "top" ? "bottom" : "top", "right", "left"];

  return (
    candidates.find((candidate) => fitsViewport(getCandidatePosition(rect, size, candidate as TooltipPlacement), size)) ||
    placement
  ) as TooltipPlacement;
}

function createTooltipState(
  target: HTMLElement,
  measuredSize?: { height: number; width: number },
): TooltipState | null {
  const label = target.dataset.tooltip?.trim();
  if (!label || target.matches(":disabled, [aria-disabled='true']")) return null;

  const rect = target.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;

  const size = measuredSize?.width && measuredSize?.height ? measuredSize : estimateTooltipSize(label);
  const placement = choosePlacement(rect, size, preferredPlacement(target));
  const raw = getCandidatePosition(rect, size, placement);
  const left = clamp(raw.left, TOOLTIP_MARGIN, window.innerWidth - size.width - TOOLTIP_MARGIN);
  const top = clamp(raw.top, TOOLTIP_MARGIN, window.innerHeight - size.height - TOOLTIP_MARGIN);

  const targetCenterX = rect.left + rect.width / 2;
  const targetCenterY = rect.top + rect.height / 2;

  return {
    arrowX: clamp(targetCenterX - left, TOOLTIP_ARROW, size.width - TOOLTIP_ARROW),
    arrowY: clamp(targetCenterY - top, TOOLTIP_ARROW, size.height - TOOLTIP_ARROW),
    label,
    left,
    placement,
    target,
    top,
  };
}

function getTooltipTarget(eventTarget: EventTarget | null) {
  if (!(eventTarget instanceof Element)) return null;
  return eventTarget.closest<HTMLElement>("[data-tooltip]:not([data-tooltip=''])");
}

export default function AppTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let nativeTitleTarget: HTMLElement | null = null;
    let nativeTitle = "";

    function restoreNativeTitle() {
      if (!nativeTitleTarget) return;
      if (nativeTitle) nativeTitleTarget.setAttribute("title", nativeTitle);
      nativeTitleTarget.removeAttribute("data-native-title");
      nativeTitleTarget = null;
      nativeTitle = "";
    }

    function showForTarget(target: HTMLElement | null) {
      restoreNativeTitle();
      if (!target) {
        setTooltip(null);
        return;
      }

      const title = target.getAttribute("title");
      if (title) {
        nativeTitleTarget = target;
        nativeTitle = title;
        target.setAttribute("data-native-title", title);
        target.removeAttribute("title");
      }

      setTooltip(createTooltipState(target));
    }

    function updateForCurrentTarget() {
      setTooltip((current) => (current ? createTooltipState(current.target) : null));
    }

    function handlePointerOver(event: PointerEvent) {
      showForTarget(getTooltipTarget(event.target));
    }

    function handleFocusIn(event: FocusEvent) {
      showForTarget(getTooltipTarget(event.target));
    }

    function handlePointerOut(event: PointerEvent) {
      const target = getTooltipTarget(event.target);
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      restoreNativeTitle();
      setTooltip(null);
    }

    function handleFocusOut(event: FocusEvent) {
      const target = getTooltipTarget(event.target);
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      restoreNativeTitle();
      setTooltip(null);
    }

    function hideTooltip() {
      restoreNativeTitle();
      setTooltip(null);
    }

    window.addEventListener("pointerover", handlePointerOver, true);
    window.addEventListener("focusin", handleFocusIn, true);
    window.addEventListener("pointerout", handlePointerOut, true);
    window.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("pointerdown", hideTooltip, true);
    window.addEventListener("keydown", hideTooltip, true);
    window.addEventListener("resize", updateForCurrentTarget);
    window.addEventListener("scroll", updateForCurrentTarget, true);

    return () => {
      restoreNativeTitle();
      window.removeEventListener("pointerover", handlePointerOver, true);
      window.removeEventListener("focusin", handleFocusIn, true);
      window.removeEventListener("pointerout", handlePointerOut, true);
      window.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("pointerdown", hideTooltip, true);
      window.removeEventListener("keydown", hideTooltip, true);
      window.removeEventListener("resize", updateForCurrentTarget);
      window.removeEventListener("scroll", updateForCurrentTarget, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const measured = createTooltipState(tooltip.target, {
      height: rect.height,
      width: rect.width,
    });
    if (!measured) return;
    if (
      Math.abs(measured.left - tooltip.left) < 0.5 &&
      Math.abs(measured.top - tooltip.top) < 0.5 &&
      Math.abs(measured.arrowX - tooltip.arrowX) < 0.5 &&
      Math.abs(measured.arrowY - tooltip.arrowY) < 0.5 &&
      measured.placement === tooltip.placement
    ) {
      return;
    }
    setTooltip(measured);
  }, [tooltip]);

  const style = useMemo(() => {
    if (!tooltip) return undefined;
    return {
      "--tooltip-caret-left": `${tooltip.arrowX}px`,
      "--tooltip-caret-top": `${tooltip.arrowY}px`,
      left: `${tooltip.left}px`,
      top: `${tooltip.top}px`,
    } as CSSProperties;
  }, [tooltip]);

  if (!tooltip || !style) return null;

  return createPortal(
    <div
      className={`app-tooltip-floating app-tooltip-floating--${tooltip.placement}`}
      ref={tooltipRef}
      role="tooltip"
      style={style}
    >
      {tooltip.label}
      <span aria-hidden="true" className="app-tooltip-floating__caret" />
    </div>,
    document.body,
  );
}
