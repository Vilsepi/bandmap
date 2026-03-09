import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { resolve } from 'node:path';

export interface BandmapBackendStackProps extends cdk.StackProps {
  /** Last.fm API key — will be set as a Lambda environment variable */
  lastFmApiKey: string;
  /** Frontend FQDN, e.g. app.example.com */
  frontendFqdn: string;
}

export class BandmapBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BandmapBackendStackProps) {
    super(scope, id, props);

    // ── DynamoDB tables ────────────────────────────────────

    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'bandmap-users',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const invitesTable = new dynamodb.Table(this, 'InvitesTable', {
      tableName: 'bandmap-invites',
      partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAtEpoch',
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

    const ratingsTable = new dynamodb.Table(this, 'RatingsTable', {
      tableName: 'bandmap-ratings',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'artistMbid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const recommendationsTable = new dynamodb.Table(this, 'RecommendationsTable', {
      tableName: 'bandmap-recommendations',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'artistMbid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const searchesTable = new dynamodb.Table(this, 'SearchesTable', {
      tableName: 'bandmap-searches',
      partitionKey: { name: 'query', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Cognito ──────────────────────────────────────────────

    const userPool = new cognito.UserPool(this, 'BandmapUserPool', {
      userPoolName: 'bandmap-users',
      signInAliases: { username: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: false,
      accountRecovery: cognito.AccountRecovery.NONE,
      autoVerify: {},
      mfa: cognito.Mfa.OFF,
      standardAttributes: {},
      customAttributes: {
        app_user_id: new cognito.StringAttribute({
          minLen: 36,
          maxLen: 36,
          mutable: false,
        }),
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('BandmapUserPoolClient', {
      userPoolClientName: 'bandmap-web-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
    });

    // ── Lambda function ────────────────────────────────────

    const backendEntry = resolve(import.meta.dirname, '../../backend/src/handler.ts');
    const inviteBackendEntry = resolve(import.meta.dirname, '../../backend/src/invite-handler.ts');

    const fn = new lambdaNode.NodejsFunction(this, 'ApiHandler', {
      functionName: 'bandmap-api',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: backendEntry,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 30,
      environment: {
        USERS_TABLE: usersTable.tableName,
        ARTISTS_TABLE: artistsTable.tableName,
        RELATED_ARTISTS_TABLE: relatedArtistsTable.tableName,
        RATINGS_TABLE: ratingsTable.tableName,
        RECOMMENDATIONS_TABLE: recommendationsTable.tableName,
        SEARCHES_TABLE: searchesTable.tableName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        LASTFM_API_KEY: props.lastFmApiKey,
      },
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node24',
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/*'],
      },
    });

    const inviteFn = new lambdaNode.NodejsFunction(this, 'InviteHandler', {
      functionName: 'bandmap-invites',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: inviteBackendEntry,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 10,
      environment: {
        USERS_TABLE: usersTable.tableName,
        INVITES_TABLE: invitesTable.tableName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        FRONTEND_BASE_URL: `https://${props.frontendFqdn}`,
      },
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: 'node24',
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant DynamoDB permissions
    usersTable.grantReadData(fn);
    usersTable.grantReadWriteData(inviteFn);
    artistsTable.grantReadWriteData(fn);
    relatedArtistsTable.grantReadWriteData(fn);
    ratingsTable.grantReadWriteData(fn);
    recommendationsTable.grantReadWriteData(fn);
    searchesTable.grantReadWriteData(fn);
    invitesTable.grantReadWriteData(inviteFn);

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:InitiateAuth'],
        resources: [userPool.userPoolArn],
      }),
    );

    inviteFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminSetUserPassword',
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    // ── API Gateway HTTP API ───────────────────────────────

    const httpApi = new apigatewayv2.HttpApi(this, 'BandmapApi', {
      apiName: 'bandmap-api',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.days(1),
      },
    });

    const prodStage = new apigatewayv2.HttpStage(this, 'ProdStage', {
      httpApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Configure prod stage throttling
    const cfnStage = prodStage.node.defaultChild as apigatewayv2.CfnStage;
    cfnStage.defaultRouteSettings = {
      throttlingBurstLimit: 10,
      throttlingRateLimit: 8,
    };

    const integration = new apigatewayv2Integrations.HttpLambdaIntegration('LambdaIntegration', fn);
    const inviteIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'InviteLambdaIntegration',
      inviteFn,
    );

    httpApi.addRoutes({
      path: '/invites',
      methods: [apigatewayv2.HttpMethod.POST, apigatewayv2.HttpMethod.OPTIONS],
      integration: inviteIntegration,
    });

    httpApi.addRoutes({
      path: '/invites/validate',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.OPTIONS],
      integration: inviteIntegration,
    });

    httpApi.addRoutes({
      path: '/invites/redeem',
      methods: [apigatewayv2.HttpMethod.POST, apigatewayv2.HttpMethod.OPTIONS],
      integration: inviteIntegration,
    });

    // Catch-all route → single Lambda
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration,
    });

    // ── Outputs ────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: prodStage.url,
      description: 'Backend API base URL',
    });

    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito user pool id',
    });

    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito user pool client id',
    });
  }
}
