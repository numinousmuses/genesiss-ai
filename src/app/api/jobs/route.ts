import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey, 
  deployCronAgents
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

export interface Agent {
    agent: string,
    prompt: string,
}
export interface JobRequest {
    ak: string,
    agents: Agent[][],
    schedule: string,
    callbackUrl: string,
    state?: string,
    brainID?: string,
}

export interface JobRequestResponse {
    jobID: string,
    brainID: string,
}

export const POST = async (req: NextRequest, res: NextResponse) => {
    // Run CORS middleware
    await runMiddleware(req, res, cors);

    if (req.method === 'POST'){
        try {
            let { ak, agents, schedule, callbackUrl, state, brainID } = await req.json();

            if (!ak || !agents || !schedule) {
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

            let {jobID, cronBrainID} = await deployCronAgents(ak,agents, schedule, callbackUrl, state, brainID)

            return {
                statusCode: 200,
                body: JSON.stringify({ jobID:jobID, brainID: cronBrainID }),
            }

        } catch (error) {
            console.error('Memory API Route Error:', error);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    } else {
        return NextResponse.json({ error: `Method ${req.method} Not Allowed` }, { status: 405 });
    }
}