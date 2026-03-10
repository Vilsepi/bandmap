# Bandmap – Copilot Instructions

## Project overview

Bandmap ([music.heap.fi](https://music.heap.fi)) is a music-discovery web app that helps users find new artists through similarity graphs powered by [Last.fm](https://www.last.fm) data. It is currently invite-only.

## Repository layout

This is a TypeScript monorepo managed with npm workspaces:

| Workspace | Path | Purpose |
|-----------|------|---------|
| `@bandmap/shared` | `packages/shared` | TypeScript types and constants shared by frontend and backend |
| `@bandmap/backend` | `packages/backend` | AWS Lambda handlers (main API + invite API) |
| `@bandmap/web` | `packages/web` | Vite SPA (frontend) |
| `@bandmap/infra` | `packages/infra` | AWS CDK stacks |

## Tech stack

- **Language**: TypeScript (ESM modules, Node.js ≥ 24)
- **Frontend**: Vite SPA (vanilla TypeScript, no framework)
- **Backend**: AWS Lambda behind API Gateway
- **Auth**: AWS Cognito (username/password, no self-sign-up)
- **Database**: AWS DynamoDB
- **Infrastructure**: AWS CDK
- **Testing**: Node.js built-in test runner (`node --test`)
- **Linting**: ESLint with `typescript-eslint`
- **Formatting**: Prettier

## Essential commands

Always run these from the **repository root** in this order:

```sh
npm run format   # auto-format TypeScript sources with Prettier
npm run clean    # clean TypeScript build outputs
npm run lint     # run ESLint
npm run test     # build all workspaces, then run all workspace tests
```

> `npm run test` builds `@bandmap/shared` first (required by the backend tests). Running backend tests directly without a prior root build will fail.

## Code conventions

- All source files are TypeScript with ESM (`"type": "module"` in every `package.json`).
- Follow the existing ESLint and Prettier configuration (`.eslintrc`, `.prettierrc`); do not introduce new rules.
- Keep types in `packages/shared/src/types.ts` for anything shared between frontend and backend.
- Prefer `const` over `let`; avoid `var`.
- Do not add `console.log` statements to production code paths; use existing logging patterns.

## API documentation and testing

- The Last.fm API shape is documented in `doc/REMOTE_API.md`.
- Sample Last.fm API responses for unit tests live in `doc/`:
  - `doc/sample.artist.getinfo.json`
  - `doc/sample.artist.getsimilar.json`
- **Do NOT make real HTTP calls to Last.fm or any other remote API** in tests. Use the sample response files instead.
- Write tests using the Node.js built-in test runner (`node:test` / `node:assert`). Look at existing `*.test.ts` files for patterns.

## Security and secrets

- **Do NOT read or log the `.env` file.** It contains live secrets managed outside of source control.
- Reference `.env.example` to understand which environment variables the application expects.
- Never commit secrets, tokens, or credentials.

## AWS / infrastructure

- Infrastructure is defined in `packages/infra` using AWS CDK.
- DynamoDB table names follow the pattern `bandmap-<entity>` (e.g., `bandmap-users`, `bandmap-ratings`).
- Authenticated API endpoints expect a Cognito bearer token in the `Authorization` header.
- The invite API is a separate Lambda handler (`invite-handler.ts`) from the main API handler (`handler.ts`).
