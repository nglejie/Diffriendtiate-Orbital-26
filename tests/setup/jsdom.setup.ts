import "@testing-library/jest-dom/vitest";

// jsdom does not implement every browser API used by the app's layout and media
// helpers, so these small shims keep component tests focused on behavior rather
// than failing on missing platform APIs.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: IntersectionObserverMock,
});

Object.defineProperty(window.URL, "createObjectURL", {
  writable: true,
  value: () => "blob:diffriendtiate-test",
});

Object.defineProperty(window.URL, "revokeObjectURL", {
  writable: true,
  value: () => {},
});

window.scrollTo = () => {};

Object.defineProperty(document, "elementFromPoint", {
  writable: true,
  value: () => document.querySelector(".ProseMirror") || document.body,
});

const emptyClientRects = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* iterator() {},
};

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  writable: true,
  value: () => new DOMRect(0, 0, 0, 0),
});

Object.defineProperty(Range.prototype, "getClientRects", {
  writable: true,
  value: () => emptyClientRects,
});
