# MG_VIS — Marlow Green visualization

A standalone frontend demo of Marlow Green: six 3D Workspaces, TYRs and subagents, twelve Bridge connections, and a scripted communication trajectory. No login, daemon, database, API credentials, or live TYR execution is required.

The Demo button is off by default. Click it to play the eight-step Dorian → subagent → Mira → subagent → Dorian story at 2× speed (20 seconds). Select a building to enter its Workspace; use Connections or Visit buttons to explore its neighbours.

## Run locally

Use Node.js 22.22.x and pnpm 10.21.0. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm start
```

Open http://localhost:3001. Set `PORT` to change the port. The start command serves static files only; it does not start the original TYR backend.

## Deploy

Deploy the repository as a static site. Use the repository root as the project directory:

| Setting | Value |
| --- | --- |
| Node | 22.22.x |
| Install | `pnpm install --frozen-lockfile --ignore-scripts` |
| Build | `pnpm build` |
| Output | `apps/web/dist` |

Vercel and Netlify configurations are included. Other hosts must serve existing static assets first and route other page requests (including `/operator?workspace=demo-dorian`) to `index.html`. Copy the entire output directory, including `maps/`, `brand/`, and `assets/`.

`apps/web/.env.demo` commits the standalone demo setting, so a fresh clone uses the same no-login presentation as the local demo. No personal `.env.local`, server secrets, databases, local runtimes, or recorded videos are included.

The topology and visible names are a reference snapshot. Activity and messages are scripted; Mira's unobserved subagents are labelled Demo helper. This repository does not connect to the production TYR deployment.

The original backend source remains in the project. Its separate commands are `pnpm build:full` and `pnpm start:full`; the demo deployment does not need them.
