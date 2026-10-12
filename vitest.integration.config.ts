import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: path.resolve(__dirname, "tests/mocks/server-only.ts") },
      { find: /^@\/db$/, replacement: path.resolve(__dirname, "tests/mocks/db.ts") },
      { find: "@clerk/nextjs/server", replacement: path.resolve(__dirname, "tests/mocks/clerk.ts") },
      { find: "next/cache", replacement: path.resolve(__dirname, "tests/mocks/next-cache.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  test: { include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
