/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey, 
  simpleChatAgent
} from '@/lib/utils';

// Function to handle CORS manually
function handleCors(req: NextRequest) {
    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  
    // Respond to preflight requests with 200 status
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers });
    }
  
    return headers;
  }

export const POST = async (req: NextRequest, res: NextResponse) => {

    const headers = handleCors(req);


    if (req.method === 'POST') {
        
        try {
        
    
            const { ak, prompt } = await req.json();
    
            if (!ak || !prompt ) {
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
    
            const response = await simpleChatAgent(prompt)
    
            return NextResponse.json({
                statusCode: 200,
                body: JSON.stringify({ response: response }),
            });
    
    
        } catch (error) {
            console.error("Schat Endpoint error: " + JSON.stringify(error, null, 2))
            return NextResponse.json({
                statusCode: 400,
                body: JSON.stringify({ error: 'This is the error' }),
            })
        }

    } else {

        return NextResponse.json({
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
        });
    }
}