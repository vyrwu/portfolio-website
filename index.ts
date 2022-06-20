import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as mime from 'mime'
import { getAllFiles } from './utils'

// TODO: Serve via Cloudfront instead
// https://github.com/pulumi/examples/blob/master/aws-ts-static-website/index.ts
const bucket = new aws.s3.Bucket('portfolio-website-prod', {
  website: {
    indexDocument: "index.html",
  },
});

function publicReadPolicyForBucket(bucketName: string): aws.iam.PolicyDocument {
    return {
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: "*",
            Action: [
                "s3:GetObject"
            ],
            Resource: [
                `arn:aws:s3:::${bucketName}/*` // policy refers to bucket name explicitly
            ]
        }]
    };
}

new aws.s3.BucketPolicy("bucketPolicy", {
    bucket: bucket.bucket,
    policy: bucket.bucket.apply(publicReadPolicyForBucket)
});

let siteFilesDir = "www"; // directory for content files

getAllFiles(siteFilesDir).map((filePath: string) => {
  return new aws.s3.BucketObject(filePath, {
    bucket: bucket,
    source: new pulumi.asset.FileAsset(filePath),
    contentType: mime.getType(filePath) || undefined
  })
})

export const bucketName = bucket.bucket;
export const websiteUrl = bucket.websiteEndpoint;
