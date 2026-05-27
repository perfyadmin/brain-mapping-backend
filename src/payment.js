const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const authMiddleware = require('./middleware/auth');
const { UpdateCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./db');
const { uploadScreenshotToS3 } = require('./s3');

const tableName = 'brainmap_results';

// Determine which keys to use
const RAZORPAY_KEY_ID = process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_LIVE_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// @route   POST /api/payment/create-order
// @desc    Create a Razorpay order
// @access  Private
router.post('/create-order', authMiddleware, async (req, res) => {
  const { amount } = req.body;

  if (!amount || isNaN(amount)) {
    return res.status(400).json({ message: 'Valid amount is required' });
  }

  try {
    const options = {
      amount: amount * 100, // Razorpay works in paise (amount * 100)
      currency: "INR",
      receipt: `r_${Date.now().toString().slice(-8)}`,
    };

    const order = await razorpay.orders.create(options);

    if (!order) {
      return res.status(500).json({ message: 'Failed to create Razorpay order' });
    }

    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID // Send the active public key to the frontend
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// @route   POST /api/payment/verify
// @desc    Verify Razorpay payment signature and unlock report
// @access  Private
router.post('/verify', authMiddleware, async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment verification parameters' });
  }

  try {
    // Generate signature to verify against the one from Razorpay
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Payment is verified! Update DynamoDB table
      
      // Ensure the record exists first (it should if they reached the Results page)
      const checkCommand = new GetCommand({
        TableName: tableName,
        Key: { email: req.user.email }
      });
      
      const { Item } = await docClient.send(checkCommand);
      
      if (!Item) {
        return res.status(404).json({ message: 'Assessment record not found' });
      }

      const updateCommand = new UpdateCommand({
        TableName: tableName,
        Key: { email: req.user.email },
        UpdateExpression: "SET unlocked = :unlocked, paymentId = :paymentId",
        ExpressionAttributeValues: {
          ":unlocked": true,
          ":paymentId": razorpay_payment_id
        },
        ReturnValues: "ALL_NEW"
      });

      await docClient.send(updateCommand);

      return res.status(200).json({ message: 'Payment verified successfully', unlocked: true });
    } else {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// @route   GET /api/payment/upi-config
// @desc    Get system UPI configuration (Active Payee address)
// @access  Public
router.get('/upi-config', async (req, res) => {
  try {
    const command = new GetCommand({
      TableName: 'brainmap_companies',
      Key: { id: 'upi_config' }
    });
    const { Item } = await docClient.send(command);
    res.status(200).json(Item || { id: 'upi_config', upiId: '', type: 'upi' });
  } catch (error) {
    console.error('Error fetching UPI config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// @route   POST /api/payment/submit-screenshot
// @desc    Upload screenshot to S3 and submit for administrative verification
// @access  Private
router.post('/submit-screenshot', authMiddleware, async (req, res) => {
  const { screenshot } = req.body;
  if (!screenshot) {
    return res.status(400).json({ message: 'Payment screenshot image is required.' });
  }

  try {
    // 1. Ensure the user's assessment result exists first
    const checkCommand = new GetCommand({
      TableName: tableName,
      Key: { email: req.user.email }
    });
    const { Item } = await docClient.send(checkCommand);
    if (!Item) {
      return res.status(404).json({ message: 'Assessment record not found.' });
    }

    // 2. Upload to S3
    const filename = `${req.user.email.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.png`;
    const s3Url = await uploadScreenshotToS3(screenshot, filename);

    // 3. Update DynamoDB result record
    const updateCommand = new UpdateCommand({
      TableName: tableName,
      Key: { email: req.user.email },
      UpdateExpression: 'SET paymentStatus = :status, paymentScreenshotUrl = :screenshotUrl, paymentSubmittedAt = :submittedAt',
      ExpressionAttributeValues: {
        ':status': 'pending',
        ':screenshotUrl': s3Url,
        ':submittedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    });

    await docClient.send(updateCommand);
    res.status(200).json({
      message: 'Screenshot uploaded successfully. Admin verification pending.',
      paymentScreenshotUrl: s3Url
    });
  } catch (error) {
    console.error('Error submitting payment screenshot:', error);
    res.status(500).json({ message: 'Failed to submit payment screenshot.' });
  }
});

// @route   POST /api/payment/apply-discount
// @desc    Apply a discount code to unlock the report instantly
// @access  Private
router.post('/apply-discount', authMiddleware, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ message: 'Discount code is required.' });
  }

  const cleanCode = code.trim().toUpperCase();

  try {
    // 1. Ensure the user's assessment result exists
    const checkCommand = new GetCommand({
      TableName: tableName,
      Key: { email: req.user.email }
    });
    const { Item } = await docClient.send(checkCommand);
    if (!Item) {
      return res.status(404).json({ message: 'Assessment record not found.' });
    }

    // 2. Query discount code from database
    const discountCommand = new GetCommand({
      TableName: 'brainmap_companies',
      Key: { id: `discount_${cleanCode}` }
    });
    const { Item: discountItem } = await docClient.send(discountCommand);

    if (!discountItem || discountItem.type !== 'discount') {
      return res.status(400).json({ message: 'Invalid or already used discount code.' });
    }

    // 3. Unlock report and save discount usage in result
    const updateCommand = new UpdateCommand({
      TableName: tableName,
      Key: { email: req.user.email },
      UpdateExpression: 'SET unlocked = :unlocked, paymentStatus = :status, discountCodeUsed = :discountCode',
      ExpressionAttributeValues: {
        ':unlocked': true,
        ':status': 'approved',
        ':discountCode': cleanCode
      }
    });
    await docClient.send(updateCommand);

    // 4. Delete the discount code immediately so it cannot be used again
    const deleteCommand = new DeleteCommand({
      TableName: 'brainmap_companies',
      Key: { id: `discount_${cleanCode}` }
    });
    await docClient.send(deleteCommand);

    res.status(200).json({
      message: 'Discount code applied successfully! Your report is now unlocked.',
      unlocked: true
    });
  } catch (error) {
    console.error('Error applying discount code:', error);
    res.status(500).json({ message: 'Failed to apply discount code.' });
  }
});

module.exports = router;
