#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BandmapStack } from './stack.js';

const app = new cdk.App();

const lastFmApiKey = process.env['LASTFM_API_KEY'];
if (!lastFmApiKey) {
  throw new Error('Missing env variable: LASTFM_API_KEY. Set it before running cdk deploy.');
}

const _stack = new BandmapStack(app, 'BandmapStack', {
  lastFmApiKey,
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'eu-north-1',
  },
});
