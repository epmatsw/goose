import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	__buildUrl,
	__fileExists,
	__isCover,
	__loadDataset,
	__normalizeIsOriginal,
	__parseShowDate,
	__parseShowYear,
	__saveDataset,
	__songKey,
	__writeCsv,
} from "../goose_rarity.js";

describe("goose-rarity internal helpers", () => {
	let tempDir;

	beforeAll(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "goose-internals-"));
	});

	afterAll(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("builds API URLs while omitting undefined params", () => {
		const url = __buildUrl("shows.json", {
			limit: 5,
			offset: undefined,
			year: 2024,
		});
		expect(url.toString()).toBe(
			"https://elgoose.net/api/v2/shows.json?limit=5&year=2024",
		);
		expect(url.searchParams.has("offset")).toBe(false);
	});

	it("normalizes isOriginal hints across types", () => {
		expect(__normalizeIsOriginal(undefined)).toBeUndefined();
		expect(__normalizeIsOriginal(1)).toBe(true);
		expect(__normalizeIsOriginal(0)).toBe(false);
		expect(__normalizeIsOriginal(" yes ")).toBe(true);
		expect(__normalizeIsOriginal("No")).toBe(false);
		expect(__normalizeIsOriginal({})).toBe(true);
	});

	it("detects covers based on flags and original artist", () => {
		expect(__isCover({ isoriginal: 1 })).toBe(false);
		expect(__isCover({ isoriginal: "0" })).toBe(true);
		expect(__isCover({ original_artist: "Band" })).toBe(true);
	});

	it("produces a stable song key from available identifiers", () => {
		expect(__songKey({ song_id: 7, songname: "Arcadia" })).toBe("id:7");
		expect(__songKey({ slug: "empress" })).toBe("slug:empress");
		expect(__songKey({ songname: "Slow Ready" })).toBe("name:slow ready");
		expect(__songKey({ uniqueid: "abc123" })).toBe("unique:abc123");
	});

	it("parses show year from multiple sources", () => {
		expect(__parseShowYear({ show_year: "2022" })).toBe(2022);
		expect(__parseShowYear({ showdate: "2021-12-31" })).toBe(2021);
		expect(__parseShowYear({ showdate: "invalid" })).toBeUndefined();
	});

	it("parses show dates and guards against invalid input", () => {
		expect(__parseShowDate("2024-05-10")?.toISOString()).toBe(
			"2024-05-10T00:00:00.000Z",
		);
		expect(__parseShowDate(undefined)).toBeUndefined();
		expect(__parseShowDate("not-a-date")).toBeUndefined();
	});

	it("writes CSV content with a trailing newline", async () => {
		const csvPath = path.join(tempDir, "rarity.csv");
		await __writeCsv(csvPath, "a,b,c");
		const contents = await fs.readFile(csvPath, "utf8");
		expect(contents).toBe("a,b,c\n");
	});

	it("saves and loads datasets using JSON serialization", async () => {
		const datasetPath = path.join(tempDir, "dataset.json");
		const payload = { shows: [{ id: 1 }], setlists: [] };
		await __saveDataset(datasetPath, payload);
		const raw = await fs.readFile(datasetPath, "utf8");
		expect(raw.trim()).toBe(
			'{\n  "shows": [\n    {\n      "id": 1\n    }\n  ],\n  "setlists": []\n}',
		);
		const loaded = await __loadDataset(datasetPath);
		expect(loaded).toEqual(payload);
	});

	it("detects whether a dataset file exists", async () => {
		const presentPath = path.join(tempDir, "present.json");
		await fs.writeFile(presentPath, "{}", "utf8");
		expect(await __fileExists(presentPath)).toBe(true);
		expect(await __fileExists(path.join(tempDir, "missing.json"))).toBe(false);
	});
});
