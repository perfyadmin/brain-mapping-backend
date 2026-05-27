const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a base64 image file directly to the S3 bucket 'perfy-bucket'
 * @param {string} base64Data - The full base64 image data URL (e.g. data:image/png;base64,...)
 * @param {string} filename - The target filename to store in S3
 * @returns {Promise<string>} The public S3 URL of the uploaded object
 */
async function uploadScreenshotToS3(base64Data, filename) {
  // Extract content-type and base64 payload from data URL
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid base64 image format. Must be a valid data URL.');
  }

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');

  const bucketName = 'perfy-bucket';
  const key = `payment_screenshots/${filename}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Construct S3 URL (Region ap-south-1 is standard for this profile)
  const region = process.env.AWS_REGION || 'ap-south-1';
  return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
}

module.exports = { uploadScreenshotToS3 };
