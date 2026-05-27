require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { DescribeTableCommand, CreateTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const { client } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// DynamoDB Table Initialization
const tableNames = ['brainmap_users', 'brainmap_results', 'brainmap_companies'];

async function initializeDatabase() {
  for (const tableName of tableNames) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`✅ Table '${tableName}' already exists in DynamoDB.`);
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`⚠️ Table '${tableName}' not found. Creating it now...`);
        try {
          const keyAttribute = tableName === 'brainmap_companies' ? 'id' : 'email';
          await client.send(
            new CreateTableCommand({
              TableName: tableName,
              KeySchema: [{ AttributeName: keyAttribute, KeyType: 'HASH' }],
              AttributeDefinitions: [{ AttributeName: keyAttribute, AttributeType: 'S' }],
              BillingMode: 'PAY_PER_REQUEST', // Serverless billing mode
            })
          );
          console.log(`⏳ Waiting for table '${tableName}' to become active...`);
          await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
          console.log(`✅ Table '${tableName}' successfully created and is now active.`);
        } catch (createError) {
          console.error(`❌ Error creating table ${tableName}:`, createError);
        }
      } else {
        console.error(`❌ Error checking table existence for ${tableName}:`, error);
      }
    }
  }
}

// Routes
const loginRoutes = require('./src/login');
const assessmentRoutes = require('./src/assessment');
const paymentRoutes = require('./src/payment');
const salesRoutes = require('./src/sales');
const adminRoutes = require('./src/admin');
app.use('/api', loginRoutes);
app.use('/api/assessment', assessmentRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/admin', adminRoutes);

// Start Server (Only when not in Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, async () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    await initializeDatabase();
  });
}

// Export the Express API for Vercel Serverless
module.exports = app;
