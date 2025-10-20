import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const COVERAGE_ROOT = path.resolve(process.cwd(), 'playwright-coverage');
const CHUNKS_DIR = path.join(COVERAGE_ROOT, 'chunks');

async function ensureChunksDir() {
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function writeCoverageChunk(testInfo: import('@playwright/test').TestInfo, result: any) {
  await ensureChunksDir();
  const chunk = {
    testId: testInfo.testId,
    title: testInfo.title,
    file: testInfo.file,
    line: testInfo.line,
    column: testInfo.column,
    project: testInfo.project.name,
    result
  };
  const filename = `${sanitizeFilename(testInfo.testId)}.json`;
  const chunkPath = path.join(CHUNKS_DIR, filename);
  await fs.writeFile(chunkPath, JSON.stringify(chunk, null, 2), 'utf8');
}

const test = base.extend({
  page: async ({ page, browserName }, use, testInfo) => {
    let session: import('playwright-core').CDPSession | null = null;
    const scriptSourceCache = new Map<string, string>();

    await page.addInitScript(() => {
      try {
        const request = indexedDB.deleteDatabase('keyval-store');
        if (request) {
          request.onerror = () => {};
          request.onsuccess = () => {};
        }
      } catch {
        // ignore failures clearing IndexedDB before load
      }
    });

    if (browserName === 'chromium') {
      session = await page.context().newCDPSession(page);
      await session.send('Debugger.enable');
      await session.send('Profiler.enable');
      await session.send('Profiler.startPreciseCoverage', {
        callCount: false,
        detailed: true
      });
    }

    await use(page);

    if (session) {
      try {
        const { result } = await session.send('Profiler.takePreciseCoverage');
        for (const entry of result) {
          if (!entry?.url || scriptSourceCache.has(entry.url)) continue;
          try {
            const { scriptSource } = await session.send('Debugger.getScriptSource', {
              scriptId: entry.scriptId
            });
            scriptSourceCache.set(entry.url, scriptSource);
          } catch {
            // ignore failures fetching source (e.g. eval scripts)
          }
        }
        await session.send('Profiler.stopPreciseCoverage');
        await session.send('Debugger.disable');
        await session.send('Profiler.disable');
        const enriched = result.map((entry) => ({
          ...entry,
          source: entry?.url ? scriptSourceCache.get(entry.url) : undefined
        }));
        await writeCoverageChunk(testInfo, enriched);
      } finally {
        try {
          await session.detach();
        } catch {
          // ignore detach errors
        }
      }
    }
  }
});

export { test, expect };
