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
3. Configure `SUPABASE_DB_MIGRATION_URL` in the ignored local `.env.local`
   file using the database connection string for that exact project. Prefer
   Supabase's IPv4-compatible Session Pooler connection when the network does
   not support IPv6. Never commit or print the connection string; confirm its
   project reference before applying it.

   ```sh
   bunx drizzle-kit check
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
   bunx drizzle-kit migrate
   ```

6. Confirm the Drizzle migration table records the expected migrations, then
   verify the application using an Admin account and approved business
   transactions. Confirm the accounting snapshot, stock counts, dealer
   balances, and reversal audit. Never create or reverse a test posting in
   production unless it is an approved business transaction.

7. Import this repository in Vercel. `vercel.json` already sets install/build commands and the `.vercel/output` folder (Vercel Build Output API, produced by Nitro's `vercel` preset).
8. Project Settings → Environment Variables (Production + Preview):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (same project URL and publishable key as above)
   - `SUPABASE_SERVICE_ROLE_KEY` — optional; required only for privileged Auth administration features. Server-only; never use it as a browser key.
   - Legacy projects may use `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` instead of the publishable-key variables. Do not mix keys from different Supabase projects.
   - For this repository, the linked Supabase project reference is `kjfzlecurkvvkcwlidxc`; confirm the URL is `https://kjfzlecurkvvkcwlidxc.supabase.co` and copy its active publishable key from Supabase Dashboard → Project Settings → API Keys. Never copy a key from another project.
   - After changing variables, redeploy the Vercel deployment so Vite rebuilds the browser bundle with the corrected `VITE_*` values.
9. Add your Vercel domain to the backend's allowed auth redirect URLs.
10. Deploy. Offline mode (service worker + `/_shell.html`) is generated automatically.

## Company logo

The company logo is served locally from `public/firoza-logo.png`, including in
reports and offline precaching. Favicon and installed-app icons are also local.
