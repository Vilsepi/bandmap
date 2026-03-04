#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BandmapStack } from './stack.js';

const app = new cdk.App();

const lastFmApiKey = process.env['LASTFM_API_KEY'];
if (!lastFmApiKey) {
  throw new Error('Missing env variable: LASTFM_API_KEY. Set it before running cdk deploy.');
}

const frontendFqdn = process.env['FRONTEND_FQDN'] ?? '';
const hostedZoneId = process.env['HOSTED_ZONE_ID'] ?? '';
const hostedZoneName = process.env['HOSTED_ZONE_NAME'] ?? '';
const frontendCertificateArn = process.env['FRONTEND_CERTIFICATE_ARN'] ?? '';

const _stack = new BandmapStack(app, 'BandmapStack', {
  lastFmApiKey,
  frontendFqdn,
  hostedZoneId,
  hostedZoneName,
  frontendCertificateArn,
  env: {
    account: process.env['AWS_ACCOUNT_ID'],
    region: process.env['AWS_REGION'],
  },
});
