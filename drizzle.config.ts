import { defineConfig } from "drizzle-kit";
import { loadEnv } from "vite";

const env = loadEnv(
  process.env.NODE_ENV ?? "development",
  process.cwd(),
  "SUPABASE_DB_MIGRATION_URL",
);
export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url: process.env.SUPABASE_DB_MIGRATION_URL ?? env.SUPABASE_DB_MIGRATION_URL ?? "",
  },
});
