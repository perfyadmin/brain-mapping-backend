const express = require('express');
const router = express.Router();
const { ScanCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
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

module.exports = router;
