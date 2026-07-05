import { useEffect } from "react";

let mockSelection = {
  content: { text: "Document channel smoke test" },
  makeGhostHighlight: () => {},
  position: {
    boundingRect: { x1: 72, y1: 60, x2: 430, y2: 100, width: 612, height: 792 },
    pageNumber: 1,
    rects: [{ x1: 72, y1: 60, x2: 430, y2: 100, width: 612, height: 792 }],
  },
};

export function __setMockSelection(selection) {
  mockSelection = selection;
}

export function AreaHighlight() {
  return <div data-testid="area-highlight" />;
}

export function TextHighlight() {
  return <div data-testid="text-highlight" />;
}

export function MonitoredHighlightContainer({ children }) {
  return <>{children}</>;
}

export function PdfLoader({ children }) {
  return (
    <div data-testid="pdf-loader">
      {typeof children === "function" ? children({}) : children}
    </div>
  );
}

export function PdfHighlighter({ children, selectionTip, utilsRef }) {
  useEffect(() => {
    utilsRef?.({
      getCurrentSelection: () => null,
      getViewer: () => ({ container: null }),
      scrollToHighlight: () => {},
    });
  }, [utilsRef]);

  return (
    <div data-testid="pdf-highlighter">
      {selectionTip ? <div data-testid="selection-tip">{selectionTip}</div> : null}
      {children}
    </div>
  );
}

export function useHighlightContainerContext() {
  return {
    highlight: {
      annotation: {},
      position: {},
    },
    isScrolledTo: false,
  };
}

export function usePdfHighlighterContext() {
  return {
    getCurrentSelection: () => mockSelection,
    getGhostHighlight: () => mockSelection,
    removeGhostHighlight: () => {},
    scrollToHighlight: () => {},
    setTip: () => {},
    updateTipPosition: () => {},
  };
}
