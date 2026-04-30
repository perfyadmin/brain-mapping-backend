const express = require('express');
const router = express.Router();
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./db');
const authMiddleware = require('./middleware/auth');

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
      completedAt: Item.completedAt
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
      completedAt: new Date().toISOString()
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

module.exports = router;
