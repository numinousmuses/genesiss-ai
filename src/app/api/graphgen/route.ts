import { NextRequest, NextResponse } from 'next/server';
import { Resource } from "sst";
import Cors from 'cors';
import { 
  verifyApiKey, 
  validateImages, 
  validateDocuments, 
  generateUniqueID, 
  searchMemory,  
  extractKeyFromS3Url,
  retrieveFromS3,
  getFileExtensionFromBase64,
  promptLLMWithConversation,
  promptLLM,
  searchInternetWithQueries,
  addMessageToChat,
  addToMemory
} from '@/lib/utils';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
// Initialize the CORS middleware
const cors = Cors({
    methods: ['POST'],
    origin: '*', // Allow all origins (adjust as necessary for your security needs)
    allowedHeaders: ['x-api-key', 'Content-Type'],
  });

  // Helper method to run middleware
async function runMiddleware(req: NextRequest, res: NextResponse, fn: Function) {
    return new Promise((resolve, reject) => {
      fn(req, res, (result: any) => {
        if (result instanceof Error) {
          return reject(result);
        }
        return resolve(result);
      });
    });
  }

export const POST = async (req: NextRequest, res: NextResponse) => {

    // Run CORS middleware
    await runMiddleware(req, res, cors);

    if (req.method === 'POST') {
        
    } else {

        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
        };
    }
}