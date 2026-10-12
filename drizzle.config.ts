import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config(); // loads .env

// Migrations use the direct (non-pooled) Neon connection string.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (Neon direct connection) in .env");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
});