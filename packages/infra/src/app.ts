#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BandmapStack } from './stack.js';

const app = new cdk.App();

const lastFmApiKey = app.node.tryGetContext('lastFmApiKey') as string | undefined;
if (!lastFmApiKey) {
  throw new Error(
    'Missing context: lastFmApiKey. Pass it with: cdk deploy -c lastFmApiKey=YOUR_KEY',
  );
}

const _stack = new BandmapStack(app, 'BandmapStack', {
  lastFmApiKey,
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'eu-north-1',
  },
});
