<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Post stock issues, sales, payments and settlements only through the atomic `post_transaction` RPC; direct financial writes are revoked to prevent partial posting and history manipulation.
- Read financial balances through the RLS-preserving `accounting_snapshot` RPC for a consistent view without Data API row truncation.
- SR activation changes use the admin-authorized `set_sr_active` RPC; self-service profile edits cannot change account activation.
- SR password resets and auth-email listing use authenticated server functions that verify an active admin through RLS before loading the privileged auth client; reset targets must be SR-only and no password is returned or logged.
