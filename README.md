# Bandmap [![Build status](https://github.com/Vilsepi/bandmap/actions/workflows/deploy.yml/badge.svg)](https://github.com/Vilsepi/bandmap/deployments/production)

[music.heap.fi](https://music.heap.fi)

Discover new music through similar artists you already like. Currently invite-only.

![screenshot](doc/screenshot.jpg)

Uses [Last.fm](https://www.last.fm) data, but does not require an account there.

## Architecture

- **Frontend** (`packages/web`): Vite SPA for invite redemption, Cognito-backed login, search, ratings, todo list, recommendations, and an artist similarity graph
- **Backend** (`packages/backend`): Two AWS Lambda handlers behind API Gateway — the main API serves auth, cached Last.fm data, ratings, and recommendations; a dedicated invite API manages invite creation, validation, and invite redemption
- **Authentication** (AWS Cognito): Username/password sign-in via a Cognito user pool and app client. Self-sign-up is disabled; new users are provisioned through invite redemption, and admins can create invite links via the `admin` Cognito group
- **Data** (DynamoDB): Stores app users, invites, cached Last.fm responses, ratings, recommendations, and cached searches
- **Infrastructure** (`packages/infra`): AWS CDK stacks for backend API, DynamoDB tables, Cognito resources, and separate frontend hosting
- **Shared** (`packages/shared`): TypeScript types and constants shared between frontend and backend

### DynamoDB Tables

| Table | Physical name | PK | SK | Purpose |
|-------|---------------|----|----|---------|
| Users | `bandmap-users` | `id` | — | Application user records linked to Cognito identities (`username`, `cognitoSub`, timestamps) |
| Invites | `bandmap-invites` | `code` | — | Invite codes for onboarding, including creator, expiry, remaining uses, and DynamoDB TTL via `expiresAtEpoch` |
| Artists | `bandmap-artists` | `mbid` | — | Cached Last.fm artist documents |
| RelatedArtists | `bandmap-related-artists` | `sourceMbid` | `targetMbid` | Cached artist similarity edges used by the graph and recommendations |
| Ratings | `bandmap-ratings` | `userId` | `artistMbid` | Per-user ratings and todo bookmarks |
| Recommendations | `bandmap-recommendations` | `userId` | `artistMbid` | Generated per-user recommendation rows |
| Searches | `bandmap-searches` | `query` | — | Cached Last.fm search results |

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Exchange username/password for a Cognito-backed session and current user profile |
| POST | `/auth/refresh` | No | Refresh an existing session using a refresh token |
| GET | `/search?q=...` | No | Search Last.fm for artists |
| POST | `/invites` | Yes (admin) | Create one or more invite codes and frontend invite URLs |
| GET | `/invites/validate?code=...` | No | Check whether an invite code exists, is unexpired, and still has uses left |
| POST | `/invites/redeem` | No | Redeem an invite code, create the Cognito user, and persist the app user record |
| GET | `/artists/{mbid}` | Yes | Get artist (pull-through cache) |
| GET | `/artists/{mbid}/related` | Yes | Get related artists (pull-through cache) |
| GET | `/ratings?status=...` | Yes | List user's ratings/todos |
| PUT | `/ratings/{mbid}` | Yes | Rate or bookmark an artist |
| DELETE | `/ratings/{mbid}` | Yes | Remove a rating/bookmark |
| GET | `/recommendations` | Yes | Get current recommendations |
| POST | `/recommendations/generate` | Yes | Regenerate recommendations |

Authenticated endpoints expect a Cognito bearer token in the `Authorization` header. Invite creation additionally requires the caller to belong to the Cognito `admin` group. In production, send login, refresh, and token-authenticated requests only over HTTPS/TLS.

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
