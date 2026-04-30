require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { DynamoDBClient, DescribeTableCommand, CreateTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize AWS DynamoDB Client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const docClient = DynamoDBDocumentClient.from(client);
module.exports.docClient = docClient; // Export for routes to use

// DynamoDB Table Initialization
const tableName = 'brainmap_users';

async function initializeDatabase() {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`✅ Table '${tableName}' already exists in DynamoDB.`);
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      console.log(`⚠️ Table '${tableName}' not found. Creating it now...`);
      try {
        await client.send(
          new CreateTableCommand({
            TableName: tableName,
            KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
            AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
            BillingMode: 'PAY_PER_REQUEST', // Serverless billing mode
          })
        );
        console.log(`⏳ Waiting for table '${tableName}' to become active...`);
        await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
        console.log(`✅ Table '${tableName}' successfully created and is now active.`);
      } catch (createError) {
        console.error('❌ Error creating table:', createError);
      }
    } else {
      console.error('❌ Error checking table existence:', error);
    }
  }
}

// Routes
const loginRoutes = require('./src/login');
app.use('/api', loginRoutes);

// Start Server
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  await initializeDatabase();
});
