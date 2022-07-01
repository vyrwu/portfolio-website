import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as mime from 'mime'
import { getAllFiles } from './utils'

const domainName = 'devanowak.com'
const environment = 'prod'
const appName = 'portfolio-website'

const tags = {
  App: appName,
  Environment: environment,
}

// ISSUE ACM CERTIFICATE
const eastRegion = new aws.Provider('east', {
  profile: aws.config.profile,
  region: 'us-east-1', // Per AWS, ACM certificate must be in the us-east-1 region.
})
const cert = new aws.acm.Certificate(
  domainName,
  {
    domainName: domainName,
    validationMethod: 'DNS',
    subjectAlternativeNames: [`www.${domainName}`],
    tags: tags,
  },
  { provider: eastRegion }
)

const zone = aws.route53.getZone({
  name: domainName,
  privateZone: false,
})

const records = cert.domainValidationOptions.apply((dvos) => {
  return dvos.map((dvo) => {
    return new aws.route53.Record(dvo.domainName, {
      allowOverwrite: true,
      name: dvo.resourceRecordName,
      records: [dvo.resourceRecordValue],
      ttl: 600, // 10 minutes
      type: aws.route53.RecordType[dvo.resourceRecordType as keyof typeof aws.route53.RecordType],
      zoneId: zone.then((z: aws.route53.GetZoneResult) => z.id),
    })
  })
})

const certValidation = new aws.acm.CertificateValidation(
  domainName,
  {
    certificateArn: cert.arn,
    validationRecordFqdns: records.apply((rs: aws.route53.Record[]) =>
      rs.map((r: aws.route53.Record) => r.fqdn)
    ),
  },
  { dependsOn: cert, provider: eastRegion }
)

// CREATE S3 BUCKET
const contentBucket = new aws.s3.Bucket(
  'content',
  {
    bucket: domainName,
    tags: tags,
  },
  { dependsOn: certValidation }
)

const siteFilesDir = 'www' // directory for content files

getAllFiles(siteFilesDir).map((filePath: string) => {
  return new aws.s3.BucketObject(
    filePath.replace('www/', ''),
    {
      acl: 'public-read',
      bucket: contentBucket,
      source: new pulumi.asset.FileAsset(filePath),
      contentType: mime.getType(filePath) || undefined,
      tags: tags,
    },
    { parent: contentBucket }
  )
})

// CREATE CLOUDFRONT DISTIBUTON
const logsBucket = new aws.s3.Bucket('requestLogs', {
  bucket: `${domainName}-logs`,
  acl: 'private',
  tags: tags,
})

const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity('cdn-oai', {
  comment: 'this is needed to setup s3 polices and make s3 not public.',
})

const bucketPolicy = new aws.s3.BucketPolicy('allow-cdn-read-bucket', {
  bucket: contentBucket.id,
  policy: pulumi
    .all([originAccessIdentity.iamArn, contentBucket.arn])
    .apply(([oaiArn, bucketArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              AWS: oaiArn,
            },
            Action: ['s3:GetObject'],
            Resource: [`${bucketArn}/*`],
          },
        ],
      })
    ),
})

const cdn = new aws.cloudfront.Distribution(
  'cdn',
  {
    enabled: true,
    aliases: [`www.${domainName}`, domainName],
    origins: [
      {
        originId: contentBucket.arn,
        domainName: contentBucket.bucketDomainName,
        s3OriginConfig: {
          originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
        },
      },
    ],

    defaultRootObject: 'index.html',

    // A CloudFront distribution can configure different cache behaviors based on the request path.
    // Here we just specify a single, default cache behavior which is just read-only requests to S3.
    defaultCacheBehavior: {
      targetOriginId: contentBucket.arn,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      forwardedValues: {
        cookies: { forward: 'none' },
        queryString: false,
      },
      minTtl: 0,
      defaultTtl: 600, // 10 minutes
      maxTtl: 600, // 10 minutes
    },
    customErrorResponses: [{ errorCode: 404, responseCode: 404, responsePagePath: '/404.html' }],
    priceClass: 'PriceClass_100',
    restrictions: {
      geoRestriction: {
        restrictionType: 'none',
      },
    },
    viewerCertificate: {
      acmCertificateArn: cert.arn,
      sslSupportMethod: 'sni-only',
    },
    loggingConfig: {
      bucket: logsBucket.bucketDomainName,
      includeCookies: false,
      prefix: `${domainName}/`,
    },
    tags: tags,
  },
  {
    dependsOn: bucketPolicy,
  }
)

new aws.route53.Record(
  `cdn-${domainName}`,
  {
    name: domainName,
    zoneId: zone.then((z: aws.route53.GetZoneResult) => z.id),
    type: 'A',
    aliases: [
      {
        name: cdn.domainName,
        zoneId: cdn.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  },
  { dependsOn: cert }
)

new aws.route53.Record(
  `cdn-www.${domainName}`,
  {
    name: `www.${domainName}`,
    zoneId: zone.then((z: aws.route53.GetZoneResult) => z.id),
    type: 'A',
    aliases: [
      {
        name: cdn.domainName,
        zoneId: cdn.hostedZoneId,
        evaluateTargetHealth: true,
      },
    ],
  },
  { dependsOn: cert }
)

// Google Domain Verification
const pulumiConfig = new pulumi.Config()
new aws.route53.Record(
  `google-verify-${domainName}`,
  {
    name: domainName,
    zoneId: zone.then((z: aws.route53.GetZoneResult) => z.id),
    type: 'TXT',
    records: [pulumiConfig.requireSecret(`google-site-verification-record-${domainName}`)],
    ttl: 300,
  },
  { dependsOn: cert }
)

export const websiteUrls = cdn.aliases

// TODO:
// - Retain 7 days of access logs
// - Price alert
// - Consider writing about alerting project on Medium, or as portfolio element.
