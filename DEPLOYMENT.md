# Safe production rollout

**Do not point Cloudflare at the new app until every check passes.** The old site and all KDE containers should stay running.

## Preconditions

1. Change this repository's visibility to private. Keep secrets only in local environment variables; do not commit `.env`, password files, database dumps, or student data.
2. Take a verified PostgreSQL backup to a secure location outside the repository: `BACKUP_DIR=$HOME/asanib-backups bash scripts/backup-db.sh`. Test a restore into a separate test database before migration.
3. Confirm existing schema and encrypted VM URL format match the new code. The new code expects `users(id,email,role,password_hash)`, `vms(id,name,os,notes,enabled,url_enc)`, and `claims(vm_id,user_id,released_at)`. No schema migration is provided because the current production schema has not been inspected.
4. Confirm database credentials with `psql` over TCP, not merely with Docker's local socket. Do not change existing passwords without checking other consumers.
5. Configure `.env` locally using `.env.example`. Set a strong `SESSION_SECRET`, existing compatible `CREDENTIAL_KEY`, HTTPS `BASE_URL`, `NODE_ENV=production`, and `TRUST_PROXY=true` only when exactly one trusted reverse proxy is in front of Node.

## Stage on a different port

Run `npm install`, `npm run check`, and `npm start` with `PORT=3080` on the Mac. Confirm `/api/health` and `/api/ready`, then test sign-in, VM listing, claiming, ownership verification, logout, and admin release using test users. Check browser developer tools for iframe/CSP issues.

## Cloudflare and security

The public `vmN.asanib.com` desktop hostnames bypass the Connect gateway. Apply separate Cloudflare Access protection or equivalent authentication at those origins. Validate that the desktop's response headers permit framing by the Connect hostname. Route portal and Connect hostnames to the staged app only after testing. The original VM hostname routes stay on the KDE containers.

## Rollback

Keep the old app running until validation is complete. Revert only the Cloudflare portal/Connect routes to the previous service on failure. Do not drop tables, change Docker volumes, or recreate KDE containers as part of rollback.
