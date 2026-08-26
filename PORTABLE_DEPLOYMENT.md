# Portable Deployment

This repository is self-contained for clean, external deployment. All runtime media referenced through local public paths is committed alongside the application source.

## Prerequisites

Use **Node.js 22 LTS** and **pnpm 10** (Corepack is recommended). Never commit environment files, credentials, dependency folders, or build output.

```bash
corepack enable
corepack prepare pnpm@10 --activate
```

## Application targets

| Application root | Hosting mode | Clean install | Build | Start / publish |
| --- | --- | --- | --- | --- |
| `.` | Static files | `pnpm --dir . install --frozen-lockfile` | `pnpm --dir . run build` | Publish the generated `dist/` directory to any static host. |

## Clean verification

Run these commands from the repository root after cloning. For a nested application, replace `.` with the application root shown above.

```bash
pnpm --dir . install --frozen-lockfile
pnpm --dir . run build
```

A successful build is the acceptance gate. In addition, verify that every referenced `/manus-storage/...` or `/assets/...` path resolves to a tracked file under the relevant public root before publishing.

## Publishing

For a **Static files** target, run the listed build command and deploy its `dist/` directory using your static hosting provider’s normal publish flow. For a **Node server** target, install and build on the host, set `NODE_ENV=production` plus the host-provided `PORT`, then run the listed production start command. Do not rely on preview-only storage, private URLs, local cache, or sandbox paths.
