import { Buffer } from "node:buffer";
import react from "@vitejs/plugin-react";
import { readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_FILENAME = "elgoose_setlists.json";
const DATASET_ROUTE = `/data/${DATASET_FILENAME}`;
const datasetPath = path.resolve(__dirname, "..", DATASET_FILENAME);

function localDatasetPlugin(): Plugin {
	return {
		name: "goose-local-dataset",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (!req.url?.startsWith(DATASET_ROUTE)) {
					next();
					return;
				}
				try {
					const file = await readFile(datasetPath);
					res.statusCode = 200;
					res.setHeader("Content-Type", "application/json");
					res.end(file);
				} catch (error) {
					res.statusCode = 404;
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify({ error: `${DATASET_FILENAME} not found` }));
				}
			});
		},
		buildStart() {
			this.addWatchFile(datasetPath);
		},
	};
}

function inlineBuildAssetsPlugin(basePath: string): Plugin {
	const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
	return {
		name: "inline-build-assets",
		apply: "build",
		enforce: "post",
		async closeBundle() {
			const outDir = path.resolve(__dirname, "..", "docs");
			const htmlPath = path.join(outDir, "index.html");

			let html: string;
			try {
				html = await readFile(htmlPath, "utf-8");
			} catch (error) {
				this.warn(
					`inline-build-assets: unable to read ${htmlPath}: ${error instanceof Error ? error.message : error}`,
				);
				return;
			}

			const normalizeReference = (reference: string) => {
				if (normalizedBase !== "/" && reference.startsWith(normalizedBase)) {
					const stripped = reference.slice(normalizedBase.length);
					return stripped.startsWith("/") ? stripped : `/${stripped}`;
				}
				return reference;
			};

			const toAssetPath = (outDirPath: string, rawReference: string) => {
				const reference = normalizeReference(rawReference);
				if (/^https?:\/\//.test(reference)) {
					return null;
				}
				if (reference.startsWith("./")) {
					return path.join(outDirPath, reference.slice(2));
				}
				if (reference.startsWith("../")) {
					return path.resolve(outDirPath, reference);
				}
				if (reference.startsWith("/")) {
					return path.join(outDirPath, reference.slice(1));
				}
				return path.join(outDirPath, reference);
			};

			const replaceStylesheets = async () => {
				const stylesheetPattern =
					/<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
				const matches = [...html.matchAll(stylesheetPattern)];
				for (const match of matches) {
					const href = match[1];
					if (!href) continue;
					const assetPath = toAssetPath(outDir, href);
					if (assetPath == null) continue;
					try {
						const css = await readFile(assetPath, "utf-8");
						const styleTag = `<style>\n${css}\n</style>`;
						html = html.replace(match[0], styleTag);
					} catch (error) {
						this.warn(
							`inline-build-assets: unable to inline stylesheet ${href}: ${
								error instanceof Error ? error.message : error
							}`,
						);
					}
				}
			};

			const replaceScripts = async () => {
				const preloadPattern =
					/<link\s+rel="modulepreload"[^>]*href="([^"]+)"[^>]*>/g;
				html = html.replace(preloadPattern, "");

				const scriptPattern =
					/<script\s+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g;
				const matches = [...html.matchAll(scriptPattern)];
				for (const match of matches) {
					const src = match[1];
					if (!src) continue;
					const assetPath = toAssetPath(outDir, src);
					if (assetPath == null) continue;
					try {
						const code = await readFile(assetPath, "utf-8");
						const encoded = Buffer.from(code, "utf-8").toString("base64");
						const dataUrl = `data:text/javascript;charset=utf-8;base64,${encoded}`;
						const updatedTag = match[0].replace(src, dataUrl);
						html = html.replace(match[0], updatedTag);
					} catch (error) {
						this.warn(
							`inline-build-assets: unable to inline script ${src}: ${error instanceof Error ? error.message : error}`,
						);
					}
				}
			};

			await replaceStylesheets();
			await replaceScripts();

			await writeFile(htmlPath, html, "utf-8");

			try {
				await rm(path.join(outDir, "assets"), { recursive: true, force: true });
			} catch (error) {
				this.warn(
					`inline-build-assets: unable to remove assets directory: ${error instanceof Error ? error.message : error}`,
				);
			}
		},
	};
}

export default defineConfig(({ command }) => {
	const isBuild = command === "build";
	const basePath = isBuild ? "/goose/" : "/";

	return {
		root: __dirname,
		base: basePath,
		plugins: [react(), localDatasetPlugin(), inlineBuildAssetsPlugin(basePath)],
		server: {
			port: 5173,
			open: false,
		},
		build: {
			outDir: path.resolve(__dirname, "..", "docs"),
			emptyOutDir: true,
			rollupOptions: {
				output: {
					manualChunks: undefined,
				},
			},
		},
	};
});
