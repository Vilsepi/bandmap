import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Artist,
  Invite,
  User,
  RelatedArtist,
  Rating,
  Recommendation,
  SearchResult,
} from '@bandmap/shared';

// ── Client setup ─────────────────────────────────────────────

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

function tableName(envVar: string): string {
  const name = process.env[envVar];
  if (!name) {
    throw new Error(`Missing environment variable: ${envVar}`);
  }
  return name;
}

function sortRelatedArtistsByMatch(items: RelatedArtist[]): RelatedArtist[] {
  return items.sort((a, b) => {
    if (b.match !== a.match) {
      return b.match - a.match;
    }

    const nameOrder = a.targetName.localeCompare(b.targetName);
    if (nameOrder !== 0) {
      return nameOrder;
    }

    return a.targetId.localeCompare(b.targetId);
  });
}

// ── Users ────────────────────────────────────────────────────

export async function getUserById(id: string): Promise<User | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('USERS_TABLE'),
      Key: { id },
    }),
  );
  return (result.Item as User | undefined) ?? null;
}

async function findUserBy(predicate: (user: User) => boolean): Promise<User | null> {
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName('USERS_TABLE'),
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const users = (result.Items as User[] | undefined) ?? [];
    const match = users.find(predicate);
    if (match) {
      return match;
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return null;
}

export async function getUserByCognitoSub(cognitoSub: string): Promise<User | null> {
  return findUserBy((user) => user.cognitoSub === cognitoSub);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  return findUserBy((user) => user.username === username);
}

export async function putUser(user: User): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName('USERS_TABLE'),
      Item: user,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

// ── Invites ──────────────────────────────────────────────────

export async function getInvite(code: string): Promise<Invite | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('INVITES_TABLE'),
      Key: { code },
    }),
  );
  return (result.Item as Invite | undefined) ?? null;
}

export async function putInvite(invite: Invite): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName('INVITES_TABLE'),
      Item: invite,
      ConditionExpression: 'attribute_not_exists(code)',
    }),
  );
}

export async function getLatestActiveInvite(
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<Invite | null> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let bestInvite: Invite | null = null;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName('INVITES_TABLE'),
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const invites = (result.Items as Invite[] | undefined) ?? [];
    for (const invite of invites) {
      const remainingUses = invite.maxUses - invite.usedCount;
      if (invite.expiresAt <= nowEpoch || remainingUses <= 0) {
        continue;
      }

      if (!bestInvite) {
        bestInvite = invite;
        continue;
      }

      const bestRemainingUses = bestInvite.maxUses - bestInvite.usedCount;
      if (remainingUses > bestRemainingUses) {
        bestInvite = invite;
        continue;
      }

      if (remainingUses === bestRemainingUses && invite.createdAt > bestInvite.createdAt) {
        bestInvite = invite;
        continue;
      }

      if (
        remainingUses === bestRemainingUses &&
        invite.createdAt === bestInvite.createdAt &&
        invite.code.localeCompare(bestInvite.code) > 0
      ) {
        bestInvite = invite;
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return bestInvite;
}

export async function redeemInvite(
  inviteCode: string,
  user: User,
  nowEpoch: number,
): Promise<void> {
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName('USERS_TABLE'),
            Item: user,
            ConditionExpression: 'attribute_not_exists(id)',
          },
        },
        {
          Update: {
            TableName: tableName('INVITES_TABLE'),
            Key: { code: inviteCode },
            UpdateExpression: 'SET usedCount = usedCount + :one',
            ConditionExpression:
              'attribute_exists(code) AND expiresAt > :nowEpoch AND usedCount < maxUses',
            ExpressionAttributeValues: {
              ':one': 1,
              ':nowEpoch': nowEpoch,
            },
          },
        },
      ],
    }),
  );
}

// ── Artists ──────────────────────────────────────────────────

export async function getArtist(artistId: string): Promise<Artist | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('ARTISTS_TABLE'),
      Key: { artistId },
    }),
  );
  return (result.Item as Artist | undefined) ?? null;
}

export async function getArtistByLastFmUrl(lastFmUrl: string): Promise<Artist | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName('ARTISTS_TABLE'),
      IndexName: 'lastFmUrl-index',
      KeyConditionExpression: 'lastFmUrl = :url',
      ExpressionAttributeValues: { ':url': lastFmUrl },
    }),
  );
  const items = (result.Items as Artist[] | undefined) ?? [];
  return items[0] ?? null;
}

export async function putArtist(artist: Artist): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName('ARTISTS_TABLE'),
      Item: artist,
    }),
  );
}

// ── Related Artists ──────────────────────────────────────────

export async function getRelatedArtists(sourceId: string): Promise<RelatedArtist[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName('RELATED_ARTISTS_TABLE'),
      KeyConditionExpression: 'sourceId = :src',
      ExpressionAttributeValues: { ':src': sourceId },
    }),
  );
  const items = (result.Items as RelatedArtist[] | undefined) ?? [];
  return sortRelatedArtistsByMatch(items);
}

export async function putRelatedArtists(sourceId: string, items: RelatedArtist[]): Promise<void> {
  const table = tableName('RELATED_ARTISTS_TABLE');

  // DynamoDB BatchWrite supports max 25 items per call
  const batches: RelatedArtist[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  // First, delete all existing related artists for this source
  const existing = await getRelatedArtists(sourceId);
  const deleteBatches: RelatedArtist[][] = [];
  for (let i = 0; i < existing.length; i += 25) {
    deleteBatches.push(existing.slice(i, i + 25));
  }
  for (const batch of deleteBatches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: batch.map((item) => ({
            DeleteRequest: {
              Key: { sourceId: item.sourceId, targetId: item.targetId },
            },
          })),
        },
      }),
    );
  }

  // Then write new items
  for (const batch of batches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      }),
    );
  }
}

// ── Ratings ──────────────────────────────────────────────────

/** Shape of rating items written before the todo/score decoupling */
interface LegacyRating {
  userId: string;
  artistId: string;
  score: number | null;
  status: 'rated' | 'todo';
  updatedAt: number;
}

/** Normalise a DynamoDB item that may still use the old `status` field. */
function normalizeLegacyRating(item: Record<string, unknown>): Rating {
  if ('status' in item && !('todo' in item)) {
    const legacy = item as unknown as LegacyRating;
    return {
      userId: legacy.userId,
      artistId: legacy.artistId,
      score: legacy.score,
      todo: legacy.status === 'todo',
      updatedAt: legacy.updatedAt,
    };
  }
  return item as unknown as Rating;
}

export async function getRating(userId: string, artistId: string): Promise<Rating | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('RATINGS_TABLE'),
      Key: { userId, artistId },
    }),
  );
  const item = result.Item as Record<string, unknown> | undefined;
  return item ? normalizeLegacyRating(item) : null;
}

export async function listRatings(userId: string, status?: 'rated' | 'todo'): Promise<Rating[]> {
  const params: {
    TableName: string;
    KeyConditionExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
    FilterExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
  } = {
    TableName: tableName('RATINGS_TABLE'),
    KeyConditionExpression: 'userId = :id',
    ExpressionAttributeValues: { ':id': userId },
  };

  if (status === 'todo') {
    // Match new items (todo = true) OR legacy items (status = 'todo')
    params.FilterExpression = 'todo = :true OR #s = :statusTodo';
    params.ExpressionAttributeValues[':true'] = true;
    params.ExpressionAttributeValues[':statusTodo'] = 'todo';
    params.ExpressionAttributeNames = { '#s': 'status' };
  } else if (status === 'rated') {
    // Match new items (score is a Number) OR legacy items (status = 'rated')
    params.FilterExpression =
      '(attribute_exists(score) AND attribute_type(score, :numType)) OR #s = :statusRated';
    params.ExpressionAttributeValues[':numType'] = 'N';
    params.ExpressionAttributeValues[':statusRated'] = 'rated';
    params.ExpressionAttributeNames = { '#s': 'status' };
  }

  const result = await docClient.send(new QueryCommand(params));
  return ((result.Items as Record<string, unknown>[] | undefined) ?? []).map(normalizeLegacyRating);
}

export async function putRating(rating: Rating): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName('RATINGS_TABLE'),
      Item: rating,
    }),
  );
}

export async function deleteRating(userId: string, artistId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: tableName('RATINGS_TABLE'),
      Key: { userId, artistId },
    }),
  );
}

// ── Recommendations ──────────────────────────────────────────

export async function listRecommendations(userId: string): Promise<Recommendation[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName('RECOMMENDATIONS_TABLE'),
      KeyConditionExpression: 'userId = :id',
      ExpressionAttributeValues: { ':id': userId },
    }),
  );
  return ((result.Items as Recommendation[] | undefined) ?? []).sort((a, b) => b.score - a.score);
}

export async function putRecommendations(userId: string, items: Recommendation[]): Promise<void> {
  const table = tableName('RECOMMENDATIONS_TABLE');

  // Delete existing recommendations for this user
  const existing = await listRecommendations(userId);
  const deleteBatches: Recommendation[][] = [];
  for (let i = 0; i < existing.length; i += 25) {
    deleteBatches.push(existing.slice(i, i + 25));
  }
  for (const batch of deleteBatches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: batch.map((item) => ({
            DeleteRequest: {
              Key: { userId: item.userId, artistId: item.artistId },
            },
          })),
        },
      }),
    );
  }

  // Write new recommendations
  const writeBatches: Recommendation[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    writeBatches.push(items.slice(i, i + 25));
  }
  for (const batch of writeBatches) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      }),
    );
  }
}

// ── Search Results Cache ─────────────────────────────────────

export interface CachedSearchResults {
  query: string;
  results: SearchResult[];
  fetchedAt: number;
}

export async function getSearchResults(query: string): Promise<CachedSearchResults | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('SEARCHES_TABLE'),
      Key: { query },
    }),
  );
  return (result.Item as CachedSearchResults | undefined) ?? null;
}

export async function putSearchResults(query: string, results: SearchResult[]): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName('SEARCHES_TABLE'),
      Item: {
        query,
        results,
        fetchedAt: Math.floor(Date.now() / 1000),
      },
    }),
  );
}
