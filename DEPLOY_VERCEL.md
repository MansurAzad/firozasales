# Deploying FE MANAGEMENT on Vercel

## Database migrations

The application currently requires database migrations `0007` through `0010`
in `drizzle/migrations` before deploying the client changes. They add stock
receipts, signup approval, dealer credit notes, and audited transaction
reversals. These are Drizzle-managed migrations; `supabase db push` does not
read this directory. Apply them to the intended Supabase project before
releasing the matching application build.

1. Confirm the project reference in `supabase/config.toml` matches the
   production project shown in the Supabase dashboard. Do not select a project
   based only on its display name.
2. Take and verify a restorable database backup. Schedule the migration during
   a maintenance window and ensure no stock or financial posting is in flight.
3. Configure `LOVABLE_DB_MIGRATION_URL` as a protected environment variable
   containing the direct migration connection string for that exact project.
   Never commit or print the connection string. Confirm the URL's project
   reference before applying it.

   ```sh
   npx drizzle-kit check
   ```

4. Review `drizzle/migrations/meta/_journal.json` and every pending SQL file,
   especially the replacements for `accounting_snapshot` and
   `post_transaction`. Restore a recent backup to a staging project, then run
   the migration there and verify balances, stock, access controls, and the
   reversal safeguards. Stop if the target database has a migration history
   that differs from the expected journal; do not mark migrations applied
   without verifying the schema.
5. Apply pending migrations only after confirming the protected connection
   points to the intended production project:

   ```sh
   npx drizzle-kit migrate
   ```

6. Confirm the Drizzle migration table records the expected migrations, then
   verify the application using an Admin account and approved business
   transactions. Confirm the accounting snapshot, stock counts, dealer
   balances, and reversal audit. Never create or reverse a test posting in
   production unless it is an approved business transaction.

1. Import this repository in Vercel. `vercel.json` already sets install/build commands and the `.vercel/output` folder (Vercel Build Output API, produced by Nitro's `vercel` preset).
2. Project Settings → Environment Variables (Production + Preview):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (same values as above)
   - `SUPABASE_SERVICE_ROLE_KEY` — only needed for the admin "reset SR password" feature; not available from Lovable Cloud, so that feature stays unavailable on Vercel.
3. Add your Vercel domain to the backend's allowed auth redirect URLs.
4. Deploy. Offline mode (service worker + `/_shell.html`) is generated automatically.

## Company logo

The company logo uses the public, CORS-enabled absolute Lovable asset URL shared in `src/lib/company-brand.ts`. Vercel does not serve the relative `/__l5e/assets-v1/` gateway. No rewrite or secret is needed; pages, PDF/Excel exports and offline precaching use the same image. Favicon and installed-app icons remain local files in `public/`. Redeploy after pulling this fix; offline branding updates when the generated worker updates online.
