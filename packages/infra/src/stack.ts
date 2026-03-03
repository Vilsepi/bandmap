import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { resolve } from 'node:path';

export interface BandmapStackProps extends cdk.StackProps {
  /** Last.fm API key — will be set as a Lambda environment variable */
  lastFmApiKey: string;
}

export class BandmapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BandmapStackProps) {
    super(scope, id, props);

    // ── DynamoDB tables ────────────────────────────────────

    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'bandmap-users',
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const artistsTable = new dynamodb.Table(this, 'ArtistsTable', {
      tableName: 'bandmap-artists',
      partitionKey: { name: 'mbid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const relatedArtistsTable = new dynamodb.Table(this, 'RelatedArtistsTable', {
      tableName: 'bandmap-related-artists',
      partitionKey: { name: 'sourceMbid', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'targetMbid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const opinionsTable = new dynamodb.Table(this, 'OpinionsTable', {
      tableName: 'bandmap-opinions',
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'artistMbid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const recommendationsTable = new dynamodb.Table(this, 'RecommendationsTable', {
      tableName: 'bandmap-recommendations',
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'artistMbid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Lambda function ────────────────────────────────────

    const backendEntry = resolve(import.meta.dirname, '../../backend/src/handler.ts');

    const fn = new lambdaNode.NodejsFunction(this, 'ApiHandler', {
      functionName: 'bandmap-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: backendEntry,
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        USERS_TABLE: usersTable.tableName,
        ARTISTS_TABLE: artistsTable.tableName,
        RELATED_ARTISTS_TABLE: relatedArtistsTable.tableName,
        OPINIONS_TABLE: opinionsTable.tableName,
        RECOMMENDATIONS_TABLE: recommendationsTable.tableName,
        LASTFM_API_KEY: props.lastFmApiKey,
      },
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant DynamoDB permissions
    usersTable.grantReadData(fn);
    artistsTable.grantReadWriteData(fn);
    relatedArtistsTable.grantReadWriteData(fn);
    opinionsTable.grantReadWriteData(fn);
    recommendationsTable.grantReadWriteData(fn);

    // ── API Gateway HTTP API ───────────────────────────────

    const httpApi = new apigatewayv2.HttpApi(this, 'BandmapApi', {
      apiName: 'bandmap-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'x-api-key'],
        maxAge: cdk.Duration.days(1),
      },
    });

    const integration = new apigatewayv2Integrations.HttpLambdaIntegration('LambdaIntegration', fn);

    // Catch-all route → single Lambda
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration,
    });

    // ── Outputs ────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.url ?? '',
      description: 'Bandmap API base URL',
    });
  }
}
