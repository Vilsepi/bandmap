# Password Reset Guide

This document describes the manual workaround for resetting a user's password when they have forgotten it. Bandmap does not have a self-service password-reset flow; the procedure below must be performed by an administrator.

The procedure has been verified against the implementation in `packages/backend/src/cognito.ts`, `packages/backend/src/auth.ts`, `packages/backend/src/db.ts`, and `packages/backend/src/invite-handler.ts`.

## Overview

User identity is stored in two places:

| Store | What is kept |
|-------|--------------|
| AWS Cognito | Credentials (username, password hash). Each Cognito user has a `custom:app_user_id` attribute that holds the application-level user ID. |
| DynamoDB (`bandmap-users` table) | Application user record (`id`, `username`, `cognitoSub`, `createdAt`) and all associated data (ratings, recommendations, etc.) keyed on `id`. |

When a session token is verified, the backend reads `custom:app_user_id` from the Cognito JWT and uses that value to look up the DynamoDB user record (`getUserById`). Preserving this linkage is the key to retaining the user's existing data after the reset.

## Prerequisites

- AWS CLI configured with sufficient permissions (Cognito `AdminDeleteUser`, `AdminUpdateUserAttributes`; DynamoDB `Scan`/`GetItem`).
- The Cognito user pool ID and the `bandmap-users` DynamoDB table name (available from the deployment outputs or environment variables).
- An active admin session in Bandmap to generate invite links.

## Step-by-step procedure

### Step 1 — Obtain the user's old application user ID from DynamoDB

Before touching Cognito, record the user's `id` from the DynamoDB `bandmap-users` table. You will need it in Step 4.

```bash
aws dynamodb scan \
  --table-name bandmap-users \
  --filter-expression "username = :u" \
  --expression-attribute-values '{":u":{"S":"<USERNAME>"}}' \
  --projection-expression "id,cognitoSub,username" \
  --output json
```

Note the `id` value (a UUIDv4) from the returned item. This is the **old user ID** that must be restored.

### Step 2 — Delete the Cognito user (keep the DynamoDB record)

Delete only the Cognito user. Do **not** delete or modify the DynamoDB record — it holds the user's `id`, which is the primary key for all their data (ratings, recommendations).

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id <USER_POOL_ID> \
  --username <USERNAME>
```

> **Important:** Because the DynamoDB record is preserved, the old username is still considered taken by the application. The user **cannot** re-register with the same username in the next step (see Step 3).

### Step 3 — Send an invite link and have the user create a new account

Generate a fresh invite link from the Bandmap admin interface (or via the `POST /invites` API endpoint) and send it to the user.

Ask the user to register with a **new username**. They cannot reuse their old username because the invite-redemption endpoint (`POST /invites/redeem`) checks for an existing DynamoDB record with that username and rejects the request with HTTP 409 if one is found.

Once the user successfully redeems the invite, a new Cognito user and a new DynamoDB record are created (with a freshly generated `id`). The user's old data is not yet accessible — that is fixed in the next step.

### Step 4 — Point the new Cognito user at the old application user ID

Update the `custom:app_user_id` attribute of the newly-created Cognito user to the **old user ID** recorded in Step 1. This re-links the new Cognito account to the existing DynamoDB record and all associated data.

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id <USER_POOL_ID> \
  --username <NEW_USERNAME> \
  --user-attributes Name=custom:app_user_id,Value="<OLD_USER_ID>"
```

> **How this works:** `verifySessionToken` in `packages/backend/src/auth.ts` reads `custom:app_user_id` from the Cognito ID token. Overwriting this attribute causes future tokens to carry the old `id`, so `getUserById` resolves the original DynamoDB record with all prior ratings and recommendations intact.

> **Note:** A secondary, orphaned DynamoDB user record (created during invite redemption in Step 3) will remain in the table with the new username and a new `id`. It is no longer reachable because no Cognito user points to it. It can be cleaned up manually with a DynamoDB `DeleteItem` call if desired, but it causes no functional harm.

### Step 5 — Ask the user to log out and log back in

The user's current session token still contains the newly-generated `id` from Step 3. They must sign out and sign back in to receive a new token that carries the corrected `custom:app_user_id`. After doing so, all their previous ratings and recommendations will be visible again.

## Summary

| Step | Action | Store affected |
|------|--------|----------------|
| 1 | Record old `id` from DynamoDB | DynamoDB (read-only) |
| 2 | Delete Cognito user | Cognito |
| 3 | User redeems invite with a new username | Cognito + DynamoDB (new records) |
| 4 | Update `custom:app_user_id` on new Cognito user to old `id` | Cognito |
| 5 | User logs out and back in | — (client-side) |
