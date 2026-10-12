import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations use the direct (non-pooled) Neon connection string.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! },
  strict: true,
});
