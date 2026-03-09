import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface BandmapFrontendStackProps extends cdk.StackProps {
  /** Frontend FQDN, e.g. app.example.com */
  frontendFqdn: string;
  /** Existing Route53 hosted zone id */
  hostedZoneId: string;
  /** Existing Route53 hosted zone name, e.g. example.com */
  hostedZoneName: string;
  /** ACM certificate ARN in us-east-1 for the frontend CloudFront CDN */
  frontendCertificateArn: string;
}

export class BandmapFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BandmapFrontendStackProps) {
    super(scope, id, props);

    const frontendBucket = new s3.Bucket(this, 'FrontendAssetsBucket', {
      bucketName: 'bandmap-frontend-assets',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    const frontendCertificate = acm.Certificate.fromCertificateArn(
      this,
      'FrontendCertificate',
      props.frontendCertificateArn,
    );

    const frontendDistribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      domainNames: [props.frontendFqdn],
      certificate: frontendCertificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const recordName = props.frontendFqdn.endsWith(`.${props.hostedZoneName}`)
      ? props.frontendFqdn.slice(0, -(props.hostedZoneName.length + 1))
      : props.frontendFqdn;

    new route53.CnameRecord(this, 'FrontendCnameRecord', {
      zone: hostedZone,
      recordName,
      domainName: frontendDistribution.distributionDomainName,
      ttl: cdk.Duration.minutes(5),
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket for frontend static assets',
    });

    new cdk.CfnOutput(this, 'FrontendDistributionDomainName', {
      value: frontendDistribution.distributionDomainName,
      description: 'CloudFront distribution domain name for frontend',
    });
  }
}
