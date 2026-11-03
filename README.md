# FE MANAGEMENT

Inventory, sales and accounting for FIROZA ENTERPRISE.

**Live app**: https://firozasales.vercel.app

## Development

You need Node.js and Bun to develop locally.

```sh
git clone <this-repository-url>
cd <repository-name>
bun install
bun run dev
```

Local Supabase settings belong in the ignored `.env.local` file. Start from
[`.env.example`](./.env.example) if one is not already present:

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

The Supabase publishable key is intended for browser use. Keep
`SUPABASE_SERVICE_ROLE_KEY` server-only; it is optional and needed only for
privileged Auth administration. Never put secrets in `VITE_` variables or
commit `.env.local`. Keep `SUPABASE_DB_MIGRATION_URL` local and protected; it
must never be deployed as a browser-visible variable.

Before deploying updates that include financial or inventory changes, review
the database migration checklist in [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) and
apply the required Supabase migrations to the verified project.
