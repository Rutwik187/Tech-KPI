import { S3Client } from '@aws-sdk/client-s3';
export const ATTACHMENT_BUCKET = 'assets';
export function storageClient() {
  if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('Object storage is not configured. Run neon deploy.');
  return new S3Client({forcePathStyle:true, endpoint:process.env.AWS_ENDPOINT_URL_S3, region:process.env.AWS_REGION, credentials:{accessKeyId:process.env.AWS_ACCESS_KEY_ID,secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY}});
}
