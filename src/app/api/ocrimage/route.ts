/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { Resource } from "sst";
import Cors from 'cors';
import { 
  verifyApiKey, 
} from '@/lib/utils';
import Replicate from 'replicate';

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
        
    
            let { ak, imageURL } = await req.json();
    
            if (!ak || !imageURL ) {
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
    
            const replicate = new Replicate({
                auth: Resource.ReplicateAPIKey.value,
              });
            
            interface GenericO {
                output?: string;
                [key: string]: any; // Allow additional properties
            }
    
            const output: GenericO = await replicate.run(
                "abiruyt/text-extract-ocr:a524caeaa23495bc9edc805ab08ab5fe943afd3febed884a4f3747aa32e9cd61",
                {
                  input: {
                    image: imageURL
                  }
                }
              );
            
            const text = output.output
    
            return NextResponse.json({
                statusCode: 200,
                body: JSON.stringify({ text: text }),
            })
    
              
              
        } catch (error) {
            console.error("OCRImage Endpoint error: " + JSON.stringify(error, null, 2))
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