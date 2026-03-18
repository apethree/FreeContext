import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: path.join(__dirname, "tests", "web"),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: path.join(__dirname, "test-results", "web"),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `ONESHOT_RENDERER_PORT=${PORT} npm run dev:web`,
    url: `http://127.0.0.1:${PORT}`,
    cwd: __dirname,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
