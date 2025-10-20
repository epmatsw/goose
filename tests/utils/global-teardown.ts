import fs from 'node:fs/promises';
import path from 'node:path';

const COVERAGE_ROOT = path.resolve(process.cwd(), 'playwright-coverage');
const CHUNKS_DIR = path.join(COVERAGE_ROOT, 'chunks');
const OUTPUT_PATH = path.join(COVERAGE_ROOT, 'coverage.json');

export default async function globalTeardown() {
  try {
    const files = await fs.readdir(CHUNKS_DIR);
    const tests = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(CHUNKS_DIR, file), 'utf8');
      tests.push(JSON.parse(content));
    }
    const aggregate = {
      generatedAt: new Date().toISOString(),
      testCount: tests.length,
      tests
    };
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(aggregate, null, 2), 'utf8');
  } catch {
    // Ignore errors when coverage directory is missing or unreadable.
  }
}
