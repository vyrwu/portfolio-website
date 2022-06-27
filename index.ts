import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as mime from 'mime'
import { getAllFiles } from './utils'

const domainName = 'devanowak.com'
const environment = 'prod'
const appName = 'portfolio-website'

const tags = {
  App: appName,
  Environment: environment
}

// ISSUE ACM CERTIFICATE
const eastRegion = new aws.Provider("east", {
  profile: aws.config.profile,
  region: 'us-east-1', // Per AWS, ACM certificate must be in the us-east-1 region.
});
const cert = new aws.acm.Certificate(domainName, {
  domainName: domainName,
  validationMethod: 'DNS',
  subjectAlternativeNames: [`www.${domainName}`],
  tags: tags,
}, { provider: eastRegion })

const zone = aws.route53.getZone({
  name: domainName,
  privateZone: false
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
    });
  })
})

const certValidation = new aws.acm.CertificateValidation(domainName, {
  certificateArn: cert.arn,
  validationRecordFqdns: records.apply((rs: aws.route53.Record[]) => rs.map((r: aws.route53.Record) => r.fqdn)),
}, { dependsOn: cert, provider: eastRegion });

// CREATE S3 BUCKET
const contentBucket = new aws.s3.Bucket('content', {
  bucket: domainName,
  website: {
    indexDocument: 'index.html',
  },
  tags: tags
}, { dependsOn: certValidation });

function publicReadPolicyForBucket(bucketName: string): aws.iam.PolicyDocument {
    return {
        Version: '2012-10-17',
        Statement: [{
            Effect: 'Allow',
            Principal: '*',
            Action: [
                's3:GetObject'
            ],
            Resource: [
                `arn:aws:s3:::${bucketName}/*` // policy refers to bucket name explicitly
            ]
        }]
    };
}

new aws.s3.BucketPolicy('content-policy', {
  bucket: contentBucket.bucket,
  policy: contentBucket.bucket.apply(publicReadPolicyForBucket),
});

let siteFilesDir = 'www'; // directory for content files

getAllFiles(siteFilesDir).map((filePath: string) => {
  return new aws.s3.BucketObject(filePath.replace('www/', ''), {
    bucket: contentBucket,
    source: new pulumi.asset.FileAsset(filePath),
    contentType: mime.getType(filePath) || undefined,
    tags: tags
  })
})

export const bucketName = contentBucket.bucket;
export const websiteUrl = contentBucket.websiteEndpoint;

// CREATE CLOUDFRONT DISTIBUTON
const logsBucket = new aws.s3.Bucket('requestLogs', {
  bucket: `${domainName}-logs`,
  acl: "private",
  tags: tags,
});

const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity('s3-private-access', {
  comment: "this is needed to setup s3 polices and make s3 not public.",
});

const cdn = new aws.cloudfront.Distribution('cdn', {
    enabled: true,
    aliases: [`www.${domainName}`, domainName],
    origins: [
        {
            originId: contentBucket.arn,
            domainName: contentBucket.websiteEndpoint,
        //     s3OriginConfig: {
        //         originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
        // },
        customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: 'http-only',
            originSslProtocols: ["TLSv1", "TLSv1.1", "TLSv1.2"]
          }
        },
  ],

    defaultRootObject: "index.html",

    // A CloudFront distribution can configure different cache behaviors based on the request path.
    // Here we just specify a single, default cache behavior which is just read-only requests to S3.
    defaultCacheBehavior: {
        targetOriginId: contentBucket.arn,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD", "OPTIONS"],
        forwardedValues: {
            cookies: { forward: "none" },
            queryString: false,
        },
        minTtl: 0,
        defaultTtl: 600, // 10 minutes
        maxTtl: 600, // 10 minutes
    },
    priceClass: "PriceClass_100",
    restrictions: {
        geoRestriction: {
            restrictionType: "none",
        },
    },
    viewerCertificate: {
        acmCertificateArn: cert.arn,
        sslSupportMethod: "sni-only",
    },
    loggingConfig: {
        bucket: logsBucket.bucketDomainName,
        includeCookies: false,
        prefix: `${domainName}/`,
    },
    tags: tags,
});

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