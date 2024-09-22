/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { Resource } from "sst";
import Cors from 'cors';
import { 
  verifyApiKey, 
} from '@/lib/utils';
import Replicate from 'replicate';

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