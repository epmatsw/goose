#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import istanbulLibCoverage from "istanbul-lib-coverage";
import istanbulLibReport from "istanbul-lib-report";
import istanbulReports from "istanbul-reports";
import v8ToIstanbul from "v8-to-istanbul";

const { createCoverageMap } = istanbulLibCoverage;
const { createContext } = istanbulLibReport;

const ROOT_DIR = process.cwd();
const DEFAULT_INPUT = path.resolve(
	ROOT_DIR,
	"playwright-coverage/coverage.json",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
	ROOT_DIR,
	"playwright-coverage/istanbul",
);
const DEFAULT_REPORTERS = ["text-summary", "json-summary", "html", "lcovonly"];

function parseArgs(argv) {
	const options = {
		input: DEFAULT_INPUT,
		outDir: DEFAULT_OUTPUT_DIR,
		reporters: DEFAULT_REPORTERS,
	};

	for (const arg of argv) {
		if (arg.startsWith("--input=")) {
			options.input = path.resolve(ROOT_DIR, arg.slice("--input=".length));
		} else if (arg.startsWith("--output=")) {
			options.outDir = path.resolve(ROOT_DIR, arg.slice("--output=".length));
		} else if (arg.startsWith("--reporters=")) {
			options.reporters = arg
				.slice("--reporters=".length)
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
		}
	}

	if (options.reporters.length === 0) {
		options.reporters = DEFAULT_REPORTERS;
	}

	return options;
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function resolveLocalPath(scriptUrl) {
	if (!scriptUrl) return null;

	let parsed;
	try {
		parsed = new URL(scriptUrl);
	} catch {
		return null;
	}

	const pathname = decodeURIComponent(parsed.pathname || "");
	if (pathname.startsWith("/@fs/")) {
		const absolutePath = pathname.slice("/@fs/".length);
		if (absolutePath.startsWith("/")) {
			return absolutePath;
		}
		return `/${absolutePath}`;
	}

	if (pathname.startsWith("/src/")) {
		return path.resolve(ROOT_DIR, "web", pathname.slice(1));
	}

	return null;
}

async function loadCoverageEntries(inputPath) {
	const raw = await fs.readFile(inputPath, "utf8");
	const aggregate = JSON.parse(raw);
	const entries = [];

	for (const test of aggregate.tests || []) {
		for (const entry of test.result || []) {
			entries.push({
				testId: test.testId,
				title: test.title,
				url: entry.url,
				functions: entry.functions,
				source: entry.source,
			});
		}
	}

	return entries;
}

async function convertCoverage(entries) {
	const converters = new Map();
	const skipped = new Map();

	const convertEntry = async (entry) => {
		if (!entry.functions || entry.functions.length === 0) return;

		const localPath = resolveLocalPath(entry.url);
		if (!localPath) {
			skipped.set(entry.url ?? "<unknown>", "Unresolvable script URL");
			return;
		}

		if (!(await fileExists(localPath))) {
			skipped.set(localPath, "File not found on disk");
			return;
		}

		let converter = converters.get(localPath);
		if (!converter) {
			let sourceCode;
			if (entry.source) {
				sourceCode = entry.source;
			} else {
				sourceCode = await fs.readFile(localPath, "utf8");
			}
			converter = v8ToIstanbul(localPath, 0, {
				source: sourceCode,
			});
			await converter.load();
			converters.set(localPath, converter);
		}

		converter.applyCoverage(entry.functions);
	};

	for (const entry of entries) {
		await convertEntry(entry);
	}

	const coverageMap = createCoverageMap({});
	for (const converter of converters.values()) {
		coverageMap.merge(converter.toIstanbul());
	}

	return { coverageMap, skipped };
}

async function writeReports(coverageMap, outDir, reporters) {
	await fs.rm(outDir, { recursive: true, force: true });
	await fs.mkdir(outDir, { recursive: true });

	const context = createContext({
		dir: outDir,
		coverageMap,
		defaultSummarizer: "nested",
		sourceFinder: (filePath) => fs.readFile(filePath, "utf8"),
	});

	for (const reporterName of reporters) {
		const reporter = istanbulReports.create(reporterName);
		reporter.execute(context);
	}
}

async function main() {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (!(await fileExists(options.input))) {
			console.error(
				`[convert-playwright-coverage] Input file not found: ${options.input}`,
			);
			process.exitCode = 1;
			return;
		}

		const entries = await loadCoverageEntries(options.input);
		if (entries.length === 0) {
			console.warn(
				"[convert-playwright-coverage] No coverage entries found in input file.",
			);
			return;
		}

		const { coverageMap, skipped } = await convertCoverage(entries);
		if (coverageMap.files().length === 0) {
			console.warn(
				"[convert-playwright-coverage] No matching source files were covered.",
			);
			if (skipped.size > 0) {
				console.warn(
					"[convert-playwright-coverage] Example skipped scripts:\n" +
						Array.from(skipped.entries())
							.slice(0, 5)
							.map(([item, reason]) => `  - ${item}: ${reason}`)
							.join("\n"),
				);
			}
			return;
		}

		await writeReports(coverageMap, options.outDir, options.reporters);

		console.log(
			"[convert-playwright-coverage] Reports written to",
			options.outDir,
		);
		if (skipped.size > 0) {
			console.log(
				`[convert-playwright-coverage] Skipped ${skipped.size} script(s) that could not be resolved.`,
			);
		}
	} catch (error) {
		console.error("[convert-playwright-coverage] Failed:", error);
		process.exitCode = 1;
	}
}

await main();
