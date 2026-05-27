const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a base64 encoded data URL (supporting all mime types like images, video, audio) directly to the S3 bucket
 * @param {string} base64Data - The full base64 encoded data URL (e.g. data:video/mp4;base64,...)
 * @param {string} folder - Target folder in S3 (e.g. payment_screenshots, testimonials)
 * @param {string} filename - The target filename to store in S3
 * @returns {Promise<string>} The public S3 URL of the uploaded object
 */
async function uploadToS3(base64Data, folder, filename) {
  // Extract content-type and base64 payload from any data URL format (supports images, videos, audio, etc.)
  const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid base64 payload. Must be a valid data URL.');
  }

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');

  const bucketName = 'perfy-bucket';
  const key = `${folder}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Construct regional S3 URL
  const region = process.env.AWS_REGION || 'ap-south-1';
  return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Backwards compatible helper for payment receipts screenshot uploads
 */
async function uploadScreenshotToS3(base64Data, filename) {
  return uploadToS3(base64Data, 'payment_screenshots', filename);
}

module.exports = { uploadToS3, uploadScreenshotToS3 };
