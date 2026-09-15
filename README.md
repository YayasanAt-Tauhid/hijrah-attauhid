# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

Install Node.js 22 (including npm) and [Bun](https://bun.com/docs/installation) 1.4.2. Production builds run Vite with Bun; dependency installation uses the existing npm lockfile.

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- [TanStack Start](https://tanstack.com/start) (full-stack React framework with SSR)
- [TanStack Router](https://tanstack.com/router) (file-based routing, `src/routes`)
- Vite + Nitro
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Supabase

### Routing

Routes are file-based under `src/routes` and the TanStack Router plugin
generates `src/routeTree.gen.ts` on `dev`/`build`. A small compatibility
layer at `src/lib/router-compat.tsx` keeps the familiar react-router API
(`useNavigate`, `useParams`, `useSearchParams`, `Link`, …) on top of
TanStack Router.

### Scripts

```sh
npm run dev      # start the dev server (SSR) on http://localhost:8080
bun --bun run build    # production build into .output (Cloudflare Workers by default)
npm run start    # run the built server (node .output/server/index.mjs)
npm test         # run unit tests (vitest)
```

## Deploy to Cloudflare Workers

`bun --bun run build` targets Cloudflare Workers by default (Nitro
`cloudflare-module` preset). The build emits `.output/server/` with a ready
`wrangler.json` (`nodejs_compat` flag + an `ASSETS` binding that serves the
client bundle from `.output/public`).

```sh
bun --bun run build                        # produces .output for Cloudflare Workers
npx wrangler deploy -c .output/server/wrangler.json
# or: npx nitro deploy --prebuilt
```

Notes:

- The Supabase URL/anon key are baked into `src/integrations/supabase/client.ts`,
  so no Worker secrets are required for the app to run. Add any extra secrets
  with `npx wrangler secret put <NAME>`.
- Set the Worker `name`/route in `.output/server/wrangler.json` (or edit
  `compatibilityDate` / preset in `vite.config.ts`).
- To build a plain Node server instead, override the preset:
  `SERVER_PRESET=node-server bun --bun run build`.

Other Nitro targets (Node, Vercel, Netlify, Deno, …) work the same way via
`SERVER_PRESET=<preset> bun --bun run build`.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
