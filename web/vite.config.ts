import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_FILENAME = 'elgoose_setlists.json';
const DATASET_ROUTE = `/data/${DATASET_FILENAME}`;
const datasetPath = path.resolve(__dirname, '..', DATASET_FILENAME);

function localDatasetPlugin(): Plugin {
  return {
    name: 'goose-local-dataset',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DATASET_ROUTE)) {
          next();
          return;
        }
        try {
          const file = await readFile(datasetPath);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(file);
        } catch (error) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `${DATASET_FILENAME} not found` }));
        }
      });
    },
    buildStart() {
      this.addWatchFile(datasetPath);
    }
  };
}

export default defineConfig({
  plugins: [react(), localDatasetPlugin()],
  server: {
    port: 5173,
    open: false
  }
});
