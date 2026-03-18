# OneShot Web Deployment (`oneshot.capzero.com`)

## Build and output

- Root directory: `apps/one-shot`
- Build command: `npm ci && npm run build:web`
- Output directory: `dist`
- Runtime: static assets (no long-running Vite server in production)

## Cloudflare Pages setup

1. Create a new Pages project for this repository path (`apps/one-shot`).
2. Configure the build and output settings above.
3. Attach custom domain: `oneshot.capzero.com`.
4. Ensure DNS points `oneshot.capzero.com` to the Pages project.

## Required environment variables

Set in the Pages project:

- `VITE_CLERK_PUBLISHABLE_KEY=<your key>`
- `VITE_ONESHOT_WS_URL=wss://ws.capzero.com/ws`
- `VITE_ONESHOT_API_URL=https://api.capzero.com`

## Clerk configuration

Add these URLs to Clerk allowed origins/redirects:

- `https://oneshot.capzero.com`
- `https://capzero.com`
