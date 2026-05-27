const express = require('express');
const router = express.Router();
const { ScanCommand, PutCommand, DeleteCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./db');
const authMiddleware = require('./middleware/auth');

// Role verification middleware
const adminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin role required.' });
  }
};

// Apply auth and admin middleware to all routes in this router
router.use(authMiddleware);
router.use(adminMiddleware);

// @route   GET /api/admin/users
// @desc    Get all registered users (excluding password hashes)
router.get('/users', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: 'brainmap_users',
    });

    const { Items = [] } = await docClient.send(command);

    // Sanitize users to remove passwords
    const sanitizedUsers = Items.map(user => {
      const { password, ...rest } = user;
      return rest;
    });

    res.status(200).json(sanitizedUsers);
  } catch (error) {
    console.error('Error scanning users:', error);
    res.status(500).json({ message: 'Failed to retrieve users' });
  }
});

// @route   GET /api/admin/results
// @desc    Get all completed assessments
router.get('/results', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: 'brainmap_results',
    });

    const { Items = [] } = await docClient.send(command);

    res.status(200).json(Items);
  } catch (error) {
    console.error('Error scanning assessment results:', error);
    res.status(500).json({ message: 'Failed to retrieve assessment results' });
  }
});

// @route   GET /api/admin/companies
// @desc    Get all companies
router.get('/companies', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: 'brainmap_companies',
    });

    const { Items = [] } = await docClient.send(command);
    res.status(200).json(Items);
  } catch (error) {
    console.error('Error scanning companies:', error);
    res.status(500).json({ message: 'Failed to retrieve companies' });
  }
});

// @route   POST /api/admin/companies
// @desc    Create a new company
router.post('/companies', async (req, res) => {
  const { name, code, industry, location } = req.body;

  if (!name || !code) {
    return res.status(400).json({ message: 'Company Name and Code are required.' });
  }

  try {
    const newCompany = {
      id: crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID(),
      name,
      code: code.toUpperCase(),
      industry: industry || '',
      location: location || '',
      createdAt: new Date().toISOString()
    };

    const command = new PutCommand({
      TableName: 'brainmap_companies',
      Item: newCompany
    });

    await docClient.send(command);
    res.status(201).json({ message: 'Company created successfully', company: newCompany });
  } catch (error) {
    console.error('Error saving company:', error);
    res.status(500).json({ message: 'Failed to save company' });
  }
});

// @route   DELETE /api/admin/companies/:id
// @desc    Delete a company
router.delete('/companies/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Company ID is required.' });
  }

  try {
    const command = new DeleteCommand({
      TableName: 'brainmap_companies',
      Key: { id }
    });

    await docClient.send(command);
    res.status(200).json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ message: 'Failed to delete company' });
  }
});

// @route   GET /api/admin/upi-config
// @desc    Get configured UPI ID
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
    res.status(500).json({ message: 'Failed to retrieve UPI configuration' });
  }
});

// @route   POST /api/admin/upi-config
// @desc    Save/update UPI ID
router.post('/upi-config', async (req, res) => {
  const { upiId } = req.body;
  if (!upiId) {
    return res.status(400).json({ message: 'UPI ID is required.' });
  }
  try {
    const item = {
      id: 'upi_config',
      upiId: upiId.trim(),
      type: 'upi',
      updatedAt: new Date().toISOString()
    };
    const command = new PutCommand({
      TableName: 'brainmap_companies',
      Item: item
    });
    await docClient.send(command);
    res.status(200).json({ message: 'UPI ID updated successfully', config: item });
  } catch (error) {
    console.error('Error updating UPI config:', error);
    res.status(500).json({ message: 'Failed to update UPI configuration' });
  }
});

// @route   GET /api/admin/discount-codes
// @desc    Get all active discount codes
router.get('/discount-codes', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: 'brainmap_companies',
    });
    const { Items = [] } = await docClient.send(command);
    const discountCodes = Items.filter(item => item.type === 'discount');
    res.status(200).json(discountCodes);
  } catch (error) {
    console.error('Error scanning discount codes:', error);
    res.status(500).json({ message: 'Failed to retrieve discount codes' });
  }
});

// @route   POST /api/admin/discount-codes
// @desc    Create a new single-use discount code
router.post('/discount-codes', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ message: 'Discount code is required.' });
  }
  const cleanCode = code.trim().toUpperCase();
  try {
    // Check if the code already exists
    const checkCommand = new GetCommand({
      TableName: 'brainmap_companies',
      Key: { id: `discount_${cleanCode}` }
    });
    const { Item } = await docClient.send(checkCommand);
    if (Item) {
      return res.status(400).json({ message: 'This discount code already exists.' });
    }

    const newDiscount = {
      id: `discount_${cleanCode}`,
      code: cleanCode,
      type: 'discount',
      createdAt: new Date().toISOString()
    };

    const command = new PutCommand({
      TableName: 'brainmap_companies',
      Item: newDiscount
    });
    await docClient.send(command);
    res.status(201).json({ message: 'Discount code created successfully', discountCode: newDiscount });
  } catch (error) {
    console.error('Error creating discount code:', error);
    res.status(500).json({ message: 'Failed to save discount code' });
  }
});

// @route   DELETE /api/admin/discount-codes/:code
// @desc    Delete a discount code
router.delete('/discount-codes/:code', async (req, res) => {
  const { code } = req.params;
  const cleanCode = code.trim().toUpperCase();
  try {
    const command = new DeleteCommand({
      TableName: 'brainmap_companies',
      Key: { id: `discount_${cleanCode}` }
    });
    await docClient.send(command);
    res.status(200).json({ message: 'Discount code deleted successfully' });
  } catch (error) {
    console.error('Error deleting discount code:', error);
    res.status(500).json({ message: 'Failed to delete discount code' });
  }
});

// @route   GET /api/admin/pending-payments
// @desc    Get all users with pending payment verification
router.get('/pending-payments', async (req, res) => {
  try {
    // 1. Scan for pending results
    const resultsCommand = new ScanCommand({
      TableName: 'brainmap_results',
    });
    const { Items: allResults = [] } = await docClient.send(resultsCommand);
    const pendingResults = allResults.filter(r => r.paymentStatus === 'pending');

    if (pendingResults.length === 0) {
      return res.status(200).json([]);
    }

    // 2. Scan users to match user details (Name, role, companyCode, school)
    const usersCommand = new ScanCommand({
      TableName: 'brainmap_users',
    });
    const { Items: allUsers = [] } = await docClient.send(usersCommand);
    const usersMap = {};
    allUsers.forEach(u => {
      usersMap[u.email] = u;
    });

    // 3. Merge pending results with user details
    const pendingDetails = pendingResults.map(r => {
      const u = usersMap[r.email] || {};
      return {
        email: r.email,
        paymentScreenshotUrl: r.paymentScreenshotUrl,
        paymentSubmittedAt: r.paymentSubmittedAt,
        name: u.name || 'Unknown User',
        role: u.role || 'student',
        companyCode: u.companyCode || null,
        school: u.school || null,
        completedAt: r.completedAt,
        selectedPlan: r.selectedPlan || 'Not Selected',
        selectedAddons: r.selectedAddons || '',
        payableAmount: r.payableAmount || 0
      };
    });

    res.status(200).json(pendingDetails);
  } catch (error) {
    console.error('Error scanning pending payments:', error);
    res.status(500).json({ message: 'Failed to retrieve pending payments' });
  }
});

// @route   POST /api/admin/approve-payment
// @desc    Approve a pending payment and unlock the user's report
router.post('/approve-payment', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'User email is required.' });
  }
  try {
    const checkCommand = new GetCommand({
      TableName: 'brainmap_results',
      Key: { email }
    });
    const { Item } = await docClient.send(checkCommand);
    if (!Item) {
      return res.status(404).json({ message: 'Assessment result not found.' });
    }

    const command = new UpdateCommand({
      TableName: 'brainmap_results',
      Key: { email },
      UpdateExpression: 'SET unlocked = :unlocked, paymentStatus = :status, paymentApprovedAt = :approvedAt',
      ExpressionAttributeValues: {
        ':unlocked': true,
        ':status': 'approved',
        ':approvedAt': new Date().toISOString()
      }
    });

    await docClient.send(command);
    res.status(200).json({ message: 'Payment approved. Report unlocked.' });
  } catch (error) {
    console.error('Error approving payment:', error);
    res.status(500).json({ message: 'Failed to approve payment' });
  }
});

// @route   POST /api/admin/reject-payment
// @desc    Reject a pending payment and clear screenshot so user can retry
router.post('/reject-payment', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'User email is required.' });
  }
  try {
    const checkCommand = new GetCommand({
      TableName: 'brainmap_results',
      Key: { email }
    });
    const { Item } = await docClient.send(checkCommand);
    if (!Item) {
      return res.status(404).json({ message: 'Assessment result not found.' });
    }

    const command = new UpdateCommand({
      TableName: 'brainmap_results',
      Key: { email },
      UpdateExpression: 'SET paymentStatus = :status REMOVE paymentScreenshotUrl, paymentSubmittedAt',
      ExpressionAttributeValues: {
        ':status': 'rejected'
      }
    });

    await docClient.send(command);
    res.status(200).json({ message: 'Payment rejected. User prompted to re-upload.' });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    res.status(500).json({ message: 'Failed to reject payment' });
  }
});

// @route   GET /api/admin/feedbacks
// @desc    Get all submitted user feedbacks & testimonials
router.get('/feedbacks', async (req, res) => {
  try {
    // 1. Scan results to get feedbacks
    const resultsCommand = new ScanCommand({
      TableName: 'brainmap_results',
    });
    const { Items: allResults = [] } = await docClient.send(resultsCommand);
    const feedbackResults = allResults.filter(r => r.feedbackSubmitted === true);

    if (feedbackResults.length === 0) {
      return res.status(200).json([]);
    }

    // 2. Scan users to match user details (Name, role, companyCode, school)
    const usersCommand = new ScanCommand({
      TableName: 'brainmap_users',
    });
    const { Items: allUsers = [] } = await docClient.send(usersCommand);
    const usersMap = {};
    allUsers.forEach(u => {
      usersMap[u.email] = u;
    });

    // 3. Merge feedbacks with user details
    const feedbacks = feedbackResults.map(r => {
      const u = usersMap[r.email] || {};
      return {
        email: r.email,
        name: u.name || 'Unknown User',
        role: u.role || 'student',
        companyCode: u.companyCode || null,
        school: u.school || null,
        rating: r.rating || 5,
        textFeedback: r.textFeedback || '',
        videoTestimonialUrl: r.videoTestimonialUrl || null,
        feedbackSubmittedAt: r.feedbackSubmittedAt || r.completedAt
      };
    });

    // Sort chronologically (newest first)
    feedbacks.sort((a, b) => new Date(b.feedbackSubmittedAt).getTime() - new Date(a.feedbackSubmittedAt).getTime());

    res.status(200).json(feedbacks);
  } catch (error) {
    console.error('Error fetching feedbacks:', error);
    res.status(500).json({ message: 'Failed to retrieve feedbacks' });
  }
});

module.exports = router;
