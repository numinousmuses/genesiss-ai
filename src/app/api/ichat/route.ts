/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { Resource } from "sst";
import Cors from 'cors';
import { 
  verifyApiKey, 
  proChatAgent,
  internetChatAgent
} from '@/lib/utils';
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

        const { ak, prompt, pro } = await req.json();

        try {
            if (!ak || !prompt || !pro) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Missing required parameters' }),
                }
            }
    
            if(!await verifyApiKey(ak)){
                return {
                    statusCode: 401,
                    body: JSON.stringify({ error: 'Unauthorized' }),
                };
            }
    
            let res: string = ''
    
            if (pro) {
                res = await proChatAgent(prompt)
            } else if (!pro) {
                res = await internetChatAgent(prompt)
            }
    
            return {
                statusCode: 200,
                body: JSON.stringify({response: res}),
            };
        } catch (error) {

            console.error("Internet Chat Endpoint error: " + JSON.stringify(error, null, 2))
            return NextResponse.json({
                statusCode: 400,
                body: JSON.stringify({ error: 'Internal Server Error' }),
            })
        }
    } else {

        return NextResponse.json({
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
        });
    }
}