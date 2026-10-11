/**
 * Optional Cloudflare R2 (S3-compatible) storage for scan uploads.
 * When env vars are missing, callers should fall back to local multer disk.
 *
 * Required env:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * Optional:
 *   R2_PUBLIC_BASE_URL (CDN/public URL prefix)
 *   R2_ENDPOINT (override; default https://{account}.r2.cloudflarestorage.com)
 */

function r2Configured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

async function getS3Client() {
  // Lazy-require so local installs without AWS SDK still boot
  const { S3Client } = require('@aws-sdk/client-s3');
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * @param {string} key object key e.g. cases/CASE-1/file.ply
 * @param {string} contentType
 * @param {number} expiresIn seconds
 */
async function createPresignedPutUrl(key, contentType, expiresIn = 900) {
  if (!r2Configured()) {
    const err = new Error('R2 is not configured');
    err.code = 'R2_NOT_CONFIGURED';
    throw err;
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = await getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const publicUrl = publicBase ? `${publicBase}/${key}` : uploadUrl.split('?')[0];
  return { uploadUrl, publicUrl, key, expiresIn };
}

/**
 * Store a scan on R2 and return a browser-reachable URL.
 * Requires R2_PUBLIC_BASE_URL so the lab can open the file after a redeploy.
 */
async function putObjectBuffer(key, body, contentType) {
  if (!r2Configured()) {
    const err = new Error('R2 is not configured');
    err.code = 'R2_NOT_CONFIGURED';
    throw err;
  }
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!publicBase) {
    const err = new Error('R2_PUBLIC_BASE_URL is not set');
    err.code = 'R2_PUBLIC_URL_MISSING';
    throw err;
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = await getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  return { key, publicUrl: `${publicBase}/${key}` };
}

module.exports = {
  r2Configured,
  createPresignedPutUrl,
  putObjectBuffer,
};
