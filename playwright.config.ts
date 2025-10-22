import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
	globalSetup: "./tests/utils/global-setup.ts",
	globalTeardown: "./tests/utils/global-teardown.ts",
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
			},
		},
	],
	webServer: {
		command: `npm run web:dev -- --host 127.0.0.1 --port ${PORT}`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 120 * 1000,
	},
});
