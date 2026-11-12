import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error ESM server middleware
import { handleApiRequest } from "./server/apiMiddleware.mjs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "gamer520-api-middleware",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          handleApiRequest(req, res, next);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          handleApiRequest(req, res, next);
        });
      },
    },
  ],
  server: {
    port: 5173,
  },
});
