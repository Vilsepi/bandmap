# [music.heap.fi](https://music.heap.fi)

Discover new music through similar artists you already like. Currently invite-only.

![screenshot](doc/screenshot.jpg)

Uses [Last.fm](https://www.last.fm) data, but does not require an account there.

## Architecture

- **Frontend** (`packages/web`): Vite SPA with search, ratings, todo list, recommendations, and an artist similarity graph
- **Backend** (`packages/backend`): Single AWS Lambda behind API Gateway — pull-through cache for Last.fm data + user ratings & recommendations
- **Infrastructure** (`packages/infra`): AWS CDK stacks — backend API/data/auth resources and a separate frontend hosting stack
- **Shared** (`packages/shared`): TypeScript types and constants shared between frontend and backend

### DynamoDB Tables

TODO: update, missing at least invites

| Table | PK | SK | Purpose |
|-------|----|----|---------|
| Users | `id` (UUID) | — | App users & metadata |
| Artists | `mbid` | — | Cached Last.fm artist data (7-day TTL) |
| RelatedArtists | `sourceMbid` | `targetMbid` | Cached artist similarity edges |
| Ratings | `userId` | `artistMbid` | User ratings & todo bookmarks |
| Recommendations | `userId` | `artistMbid` | Per-user recommendations |

### API Endpoints

TODO: Update, missing at least invite path

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/search?q=...` | No | Search Last.fm for artists |
| GET | `/artists/{mbid}` | Yes | Get artist (pull-through cache) |
| GET | `/artists/{mbid}/related` | Yes | Get related artists (pull-through cache) |
| GET | `/ratings?status=...` | Yes | List user's ratings/todos |
| PUT | `/ratings/{mbid}` | Yes | Rate or bookmark an artist |
| DELETE | `/ratings/{mbid}` | Yes | Remove a rating/bookmark |
| GET | `/recommendations` | Yes | Get current recommendations |
| POST | `/recommendations/generate` | Yes | Regenerate recommendations |

Uses Cognito authentication.

## Prerequisites

- Node.js >= 24
- A [Last.fm API key](https://www.last.fm/api/account/create)
- AWS account + credentials (for deployment)

## Install dependencies

```sh
npm install
```

## Build

```sh
npm run build
```

## Run unit tests, linter and autoformatter

```sh
npm run test
npm run lint
npm run format
```

## Deploy to AWS

To deploy the backend AWS infra resources and the backend Lambda code:

```sh
npm run deploy:backend
```

To deploy the frontend hosting infra:

```sh
npm run deploy:frontend
```

To upload the static frontend assets to the CDN:

```sh
npm run deploy:assets
```

## Run the frontend locally

You can directly serve the frontend without building it first:

```sh
npm run serve
```

Then open http://localhost:5173 in your browser and enter your API key in the settings panel.
