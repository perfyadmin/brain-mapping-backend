const express = require('express');
const router = express.Router();
const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./db');
const authMiddleware = require('./middleware/auth');
const { uploadToS3 } = require('./s3');

const tableName = 'brainmap_results';

// @route   GET /api/assessment
// @desc    Get user's assessment history/results
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
  try {
    const command = new GetCommand({
      TableName: tableName,
      Key: { email: req.user.email },
    });

    const { Item } = await docClient.send(command);

    if (!Item) {
      return res.status(200).json({ completed: false });
    }

    res.status(200).json({
      completed: true,
      responses: Item.responses,
      completedAt: Item.completedAt,
      unlocked: Item.unlocked || false,
      paymentStatus: Item.paymentStatus || null,
      paymentScreenshotUrl: Item.paymentScreenshotUrl || null,
      feedbackSubmitted: Item.feedbackSubmitted || false,
      rating: Item.rating || null,
      textFeedback: Item.textFeedback || null,
      videoTestimonialUrl: Item.videoTestimonialUrl || null
    });
  } catch (error) {
    console.error('Error fetching assessment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// @route   POST /api/assessment
// @desc    Submit user's assessment responses
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
  const { responses } = req.body;

  if (!responses || typeof responses !== 'object') {
    return res.status(400).json({ message: 'Valid responses object is required' });
  }

  try {
    // Check if already completed
    const checkCommand = new GetCommand({
      TableName: tableName,
      Key: { email: req.user.email },
    });
    const { Item } = await docClient.send(checkCommand);
    
    if (Item) {
      return res.status(400).json({ message: 'Assessment already completed.' });
    }

    const newResult = {
      email: req.user.email,
      responses,
      completedAt: new Date().toISOString(),
      unlocked: false
    };

    const putCommand = new PutCommand({
      TableName: tableName,
      Item: newResult,
    });

    await docClient.send(putCommand);

    res.status(201).json({ message: 'Assessment results saved successfully.' });
  } catch (error) {
    console.error('Error saving assessment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// @route   POST /api/assessment/feedback
// @desc    Submit user's rating, text testimonial, and optional video review
// @access  Private
router.post('/feedback', authMiddleware, async (req, res) => {
  const { rating, text, video } = req.body;

  if (rating === undefined || isNaN(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Valid rating between 1 and 5 is required.' });
  }

  try {
    // 1. Ensure the user's assessment result exists
    const checkCommand = new GetCommand({
      TableName: tableName,
      Key: { email: req.user.email },
    });
    const { Item } = await docClient.send(checkCommand);
    if (!Item) {
      return res.status(404).json({ message: 'Assessment record not found.' });
    }

    // 2. Upload video if provided
    let videoUrl = null;
    if (video) {
      // Validate that it's a valid video data URL
      if (!video.startsWith('data:video/')) {
        return res.status(400).json({ message: 'Only video testimonial files are supported.' });
      }
      
      const fileExt = video.includes('video/mp4') ? 'mp4' : video.includes('video/quicktime') ? 'mov' : 'webm';
      const filename = `${req.user.email.replace(/[^a-zA-Z0-9]/g, '_')}_video_${Date.now()}.${fileExt}`;
      videoUrl = await uploadToS3(video, 'testimonials', filename);
    }

    // 3. Update result record
    const updateCommand = new UpdateCommand({
      TableName: tableName,
      Key: { email: req.user.email },
      UpdateExpression: 'SET feedbackSubmitted = :submitted, rating = :rating, textFeedback = :text, videoTestimonialUrl = :videoUrl, feedbackSubmittedAt = :submittedAt',
      ExpressionAttributeValues: {
        ':submitted': true,
        ':rating': parseInt(rating),
        ':text': text || '',
        ':videoUrl': videoUrl,
        ':submittedAt': new Date().toISOString()
      }
    });

    await docClient.send(updateCommand);
    res.status(200).json({ message: 'Feedback submitted successfully. Report unlocked for download!', videoTestimonialUrl: videoUrl });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ message: 'Failed to submit feedback.' });
  }
});

// @route   POST /api/assessment/profile-photo
// @desc    Upload user's profile photo to S3 and save URL in DynamoDB
// @access  Private
router.post('/profile-photo', authMiddleware, async (req, res) => {
  const { photo } = req.body;

  if (!photo) {
    return res.status(400).json({ message: 'Photo base64 data is required.' });
  }

  try {
    // 1. Ensure the user's assessment result exists
    const checkCommand = new GetCommand({
      TableName: tableName,
      Key: { email: req.user.email },
    });
    const { Item } = await docClient.send(checkCommand);
    if (!Item) {
      return res.status(404).json({ message: 'Assessment record not found.' });
    }

    // 2. Upload to S3 folder "profile_photos"
    const fileExt = photo.includes('image/png') ? 'png' : 'jpg';
    const filename = `${req.user.email.replace(/[^a-zA-Z0-9]/g, '_')}_profile_${Date.now()}.${fileExt}`;
    const s3Url = await uploadToS3(photo, 'profile_photos', filename);

    // 3. Save S3 URL in result record
    const updateCommand = new UpdateCommand({
      TableName: tableName,
      Key: { email: req.user.email },
      UpdateExpression: 'SET profilePhotoUrl = :s3Url',
      ExpressionAttributeValues: {
        ':s3Url': s3Url
      }
    });

    await docClient.send(updateCommand);
    res.status(200).json({ message: 'Profile photo uploaded successfully.', profilePhotoUrl: s3Url });
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    res.status(500).json({ message: 'Failed to upload profile photo.' });
  }
});

module.exports = router;
