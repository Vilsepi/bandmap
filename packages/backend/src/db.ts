import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Artist,
  User,
  RelatedArtist,
  Opinion,
  Recommendation,
  SearchResult,
} from '@bandmap/shared';

// ── Client setup ─────────────────────────────────────────────

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// Table names from environment variables
function tableName(envVar: string): string {
  const name = process.env[envVar];
  if (!name) {
    throw new Error(`Missing environment variable: ${envVar}`);
  }
  return name;
}

// ── Users ────────────────────────────────────────────────────

export async function getUser(apiKey: string): Promise<User | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('USERS_TABLE'),
      Key: { apiKey },
    }),
  );
  return (result.Item as User | undefined) ?? null;
}

// ── Artists ──────────────────────────────────────────────────

export async function getArtist(mbid: string): Promise<Artist | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('ARTISTS_TABLE'),
      Key: { mbid },
    }),
  );
  return (result.Item as Artist | undefined) ?? null;
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

export async function getRelatedArtists(sourceMbid: string): Promise<RelatedArtist[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName('RELATED_ARTISTS_TABLE'),
      KeyConditionExpression: 'sourceMbid = :src',
      ExpressionAttributeValues: { ':src': sourceMbid },
    }),
  );
  return (result.Items as RelatedArtist[] | undefined) ?? [];
}

export async function putRelatedArtists(sourceMbid: string, items: RelatedArtist[]): Promise<void> {
  const table = tableName('RELATED_ARTISTS_TABLE');

  // DynamoDB BatchWrite supports max 25 items per call
  const batches: RelatedArtist[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  // First, delete all existing related artists for this source
  const existing = await getRelatedArtists(sourceMbid);
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
              Key: { sourceMbid: item.sourceMbid, targetMbid: item.targetMbid },
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

// ── Opinions ─────────────────────────────────────────────────

export async function getOpinion(apiKey: string, artistMbid: string): Promise<Opinion | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName('OPINIONS_TABLE'),
      Key: { apiKey, artistMbid },
    }),
  );
  return (result.Item as Opinion | undefined) ?? null;
}

export async function listOpinions(apiKey: string, status?: 'rated' | 'todo'): Promise<Opinion[]> {
  const params: {
    TableName: string;
    KeyConditionExpression: string;
    ExpressionAttributeValues: Record<string, string>;
    FilterExpression?: string;
  } = {
    TableName: tableName('OPINIONS_TABLE'),
    KeyConditionExpression: 'apiKey = :key',
    ExpressionAttributeValues: { ':key': apiKey },
  };

  if (status) {
    params.FilterExpression = '#s = :status';
    params.ExpressionAttributeValues[':status'] = status;
  }

  const result = await docClient.send(
    new QueryCommand({
      ...params,
      ...(status ? { ExpressionAttributeNames: { '#s': 'status' } } : {}),
    }),
  );
  return (result.Items as Opinion[] | undefined) ?? [];
}

export async function putOpinion(opinion: Opinion): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: tableName('OPINIONS_TABLE'),
      Item: opinion,
    }),
  );
}

export async function deleteOpinion(apiKey: string, artistMbid: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: tableName('OPINIONS_TABLE'),
      Key: { apiKey, artistMbid },
    }),
  );
}

// ── Recommendations ──────────────────────────────────────────

export async function listRecommendations(apiKey: string): Promise<Recommendation[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName('RECOMMENDATIONS_TABLE'),
      KeyConditionExpression: 'apiKey = :key',
      ExpressionAttributeValues: { ':key': apiKey },
    }),
  );
  return (result.Items as Recommendation[] | undefined) ?? [];
}

export async function putRecommendations(apiKey: string, items: Recommendation[]): Promise<void> {
  const table = tableName('RECOMMENDATIONS_TABLE');

  // Delete existing recommendations for this user
  const existing = await listRecommendations(apiKey);
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
              Key: { apiKey: item.apiKey, artistMbid: item.artistMbid },
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
  fetchedAt: string;
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
        fetchedAt: new Date().toISOString(),
      },
    }),
  );
}
