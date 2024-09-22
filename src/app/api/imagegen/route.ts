/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey, 
  imageGenerationAgent
} from '@/lib/utils';

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
            
            const { ak, prompt, height, width } = await req.json();
    
            if (!ak || !prompt) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Missing required parameters' }),
                };
            }
    
            if (!await verifyApiKey(ak)) {
                return {
                    statusCode: 401,
                    body: JSON.stringify({ error: 'Unauthorized' }),
                };
            }
    
            const res = await imageGenerationAgent(prompt, height, width)
    
            return NextResponse.json({
                statusCode: 200,
                body: JSON.stringify({ imageeURL: res }),
            })
    
        } catch (error) {
            console.error("ImageGen Endpoint error: " + JSON.stringify(error, null, 2))
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