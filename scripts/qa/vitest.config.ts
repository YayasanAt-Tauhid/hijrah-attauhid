import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["scripts/qa/*.e2e.ts"],
    testTimeout: 60_000,
    maxWorkers: 1,
    fileParallelism: false,
    bail: 1,
  },
});
