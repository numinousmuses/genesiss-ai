/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey, 
  proChatAgent,
  internetChatAgent
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