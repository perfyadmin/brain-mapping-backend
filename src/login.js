const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

// In order to avoid circular dependencies, we import docClient dynamically or require it from the parent
// Wait, we exported docClient in server.js, but requiring it here might cause issues if not done carefully.
// Instead, let's require it directly.
const { docClient } = require('../server');

const tableName = 'brainmap_users';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// User Registration Route
router.post('/register', async (req, res) => {
  const { name, email, password, role, phone, school, companyCode, department } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Name, email, password, and role are required.' });
  }

  try {
    // 1. Check if user already exists
    const checkUserCommand = new GetCommand({
      TableName: tableName,
      Key: { email },
    });
    
    const { Item } = await docClient.send(checkUserCommand);
    
    if (Item) {
      return res.status(409).json({ message: 'User with this email already exists.' });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Save new user to DynamoDB
    const newUser = {
      email,
      name,
      password: hashedPassword,
      role,
      phone,
      school,
      companyCode,
      department,
      createdAt: new Date().toISOString()
    };

    // Remove undefined fields to avoid DynamoDB errors
    Object.keys(newUser).forEach(key => newUser[key] === undefined && delete newUser[key]);

    const putCommand = new PutCommand({
      TableName: tableName,
      Item: newUser,
    });

    await docClient.send(putCommand);

    // Also generate a token right after registration so frontend can log them in immediately
    const payload = {
      user: { email: newUser.email, name: newUser.name, role: newUser.role }
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ 
      message: 'User registered successfully!',
      token,
      user: { email: newUser.email, name: newUser.name, role: newUser.role }
    });

  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ message: 'Internal server error during registration.' });
  }
});

// User Login Route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    // 1. Find user by email
    const getUserCommand = new GetCommand({
      TableName: tableName,
      Key: { email },
    });

    const { Item: user } = await docClient.send(getUserCommand);

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // 2. Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // 3. Generate JWT
    const payload = {
      user: {
        email: user.email,
        name: user.name,
        role: user.role
      }
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({
      message: 'Login successful',
      token,
      user: { email: user.email, name: user.name, role: user.role }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Internal server error during login.' });
  }
});

module.exports = router;
