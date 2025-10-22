import fs from "node:fs/promises";
import path from "node:path";

const COVERAGE_ROOT = path.resolve(process.cwd(), "playwright-coverage");

export default async function globalSetup() {
	await fs.rm(COVERAGE_ROOT, { recursive: true, force: true });
	await fs.mkdir(path.join(COVERAGE_ROOT, "chunks"), { recursive: true });
}
