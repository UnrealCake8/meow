# Asan IB Cloud — clean rebuild

New student portal and backend. **Do not deploy over the existing production app yet.** This repo is currently public: never commit `.env`, credentials, DB dumps, or student information.

## Development

1. `npm install`
2. Copy `.env.example` to `.env` and supply your own credentials.
3. `npm run check`
4. `npm start`
5. Open `http://localhost:3080`.

Requires an existing PostgreSQL database and the existing `users`, `vms`, and `claims` schema. No destructive migrations or container changes are performed. This version deliberately **does not** expose encrypted VM credentials. It uses the existing student password hashes and claims.

## Domain layout

- `portal.asanib.com` — portal.
- `connect-vm1.asanib.com` … `connect-vm21.asanib.com` — login and desktop viewer.
- `vm1.asanib.com` … `vm21.asanib.com` — underlying desktops.

The Connect gateway checks the claimed VM's **stored URL** against the requested VM number. It never treats a database row ID as a desktop number. It returns only a canonical `https://vmN.asanib.com` URL.

## Security and rollout

This is a development baseline, not a production-ready release. Direct `vmN` addresses must be protected separately (e.g. Cloudflare Access) or the gateway can be bypassed. Also confirm the remote desktop allows framing: a response header like `X-Frame-Options: DENY` will block the iframe regardless of this app's CSP. Test HTTPS proxy trust, sessions, login, permissions, and the database before cutover. Keep your current PostgreSQL and KDE containers untouched.
