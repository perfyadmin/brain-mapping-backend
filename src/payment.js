const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const authMiddleware = require('./middleware/auth');
const { UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./db');

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

module.exports = router;
