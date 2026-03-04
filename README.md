# Bandmap

Discover new music through artist similarity. Uses [Last.fm](https://www.last.fm) data with a serverless AWS backend that acts as a pull-through cache.

## Architecture

- **Frontend** (`packages/web`): Vite SPA with search, ratings, todo list, recommendations, and an artist similarity graph
- **Backend** (`packages/backend`): Single AWS Lambda behind API Gateway — pull-through cache for Last.fm data + user ratings & recommendations
- **Infrastructure** (`packages/infra`): AWS CDK stack — API Gateway HTTP API, Lambda, 5 DynamoDB tables
- **Shared** (`packages/shared`): TypeScript types and constants shared between frontend and backend

### DynamoDB Tables

| Table | PK | SK | Purpose |
|-------|----|----|---------|
| Users | `id` (UUID) | — | App users & metadata |
| Artists | `mbid` | — | Cached Last.fm artist data (7-day TTL) |
| RelatedArtists | `sourceMbid` | `targetMbid` | Cached artist similarity edges |
| Ratings | `userId` | `artistMbid` | User ratings & todo bookmarks |
| Recommendations | `userId` | `artistMbid` | Per-user recommendations |

### API Endpoints

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

Auth is via `x-api-key` header matching a record in the Users table.

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

```sh
npm run deploy
```

The deploy output will show the API Gateway URL. Set this in the frontend via the `VITE_API_BASE_URL` environment variable.

## Create a user

After deploying, manually add a user to the Users DynamoDB table:

```sh
aws dynamodb put-item \
  --table-name bandmap-users \
  --item '{"id": {"S": "your-user-uuid"}, "apiKey": {"S": "your-secret-key"}, "name": {"S": "Your Name"}, "createdAt": {"S": "2026-01-01T00:00:00Z"}}'
```

## Run the frontend locally

```sh
npm run serve
```

Then open http://localhost:5173 in your browser and enter your API key in the settings panel.
