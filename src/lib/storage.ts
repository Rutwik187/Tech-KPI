import { S3Client } from '@aws-sdk/client-s3';
import { AppError } from '@/server/errors';

/**
 * Where files are stored. The workspace uses its own private S3 bucket, set by the `FILES_S3_*` settings.
 * Without them it falls back to the Neon `assets` bucket and its `AWS_*` settings, which `npm run neon:deploy` manages.
 * The two sets have different names, so a Neon deploy never overwrites the file bucket's keys.
 */
function settings() {
  const env = process.env;
  if (env.FILES_S3_BUCKET) {
    const region = env.FILES_S3_REGION || 'us-east-1';
    // Named on purpose. Otherwise the SDK picks up AWS_ENDPOINT_URL_S3, the Neon storage address, and sends the file there.
    return { bucket: env.FILES_S3_BUCKET, region, endpoint: env.FILES_S3_ENDPOINT || `https://s3.${region}.amazonaws.com`, pathStyle: !!env.FILES_S3_ENDPOINT,
      accessKeyId: env.FILES_S3_ACCESS_KEY_ID, secretAccessKey: env.FILES_S3_SECRET_ACCESS_KEY };
  }
  return { bucket: 'assets', region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL_S3, pathStyle: true, accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY };
}

export function attachmentBucket() { return settings().bucket; }

export function storageClient() {
  const config = settings();
  if (!config.accessKeyId || !config.secretAccessKey || (!process.env.FILES_S3_BUCKET && !config.endpoint)) {
    throw new AppError('File storage is not set up on this server. Ask an admin to add the storage settings.', 503);
  }
  // Checksums only when an operation needs one. By default the SDK signs an empty-body checksum into upload links,
  // which makes every browser upload fail.
  return new S3Client({
    region: config.region, endpoint: config.endpoint, forcePathStyle: config.pathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
