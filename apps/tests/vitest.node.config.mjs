import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // API, AI, performance, and security suites run real Node servers and HTTP
    // requests, so they use the Node environment instead of jsdom.
    environment: "node",
    globals: true,
    reporters: "default",
    hookTimeout: 30_000,
    testTimeout: 60_000,
  },
});
