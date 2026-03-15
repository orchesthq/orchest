import dotenv from "dotenv";
import path from "path";
import { createApp } from "./app";
import { isDbConfigured, pingDb } from "./db/client";

// In local dev, load env from the API workspace (`apps/api/.env`).
// In production, hosts (Vercel, AWS, etc.) provide env vars and this becomes a no-op.
dotenv.config({
  path: process.env.DOTENV_PATH ?? path.resolve(process.cwd(), ".env"),
});

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();

  if (isDbConfigured()) {
    try {
      await pingDb();
      console.log("[startup] database connection OK");
    } catch (err) {
      console.error(
        "[startup] database ping failed (server will start, but DB-backed endpoints may fail)",
        err
      );
    }
  } else {
    console.warn(
      "[startup] DATABASE_URL not set (server will start; DB-backed endpoints will return 503)"
    );
  }

  const server = app.listen(port, () => {
    console.log(`[startup] listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    console.log("[shutdown] stopping server");
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();

