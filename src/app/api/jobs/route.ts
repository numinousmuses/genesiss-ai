/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey, 
  deployCronAgents
} from '@/lib/utils';
import { CloudWatchEventsClient, DeleteRuleCommand } from '@aws-sdk/client-cloudwatch-events';

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
    
    const headers = handleCors(req);

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

export const DELETE = async (req: NextRequest, res: NextResponse) => {
    // Run CORS middleware
    const headers = handleCors(req);
    
    if (req.method === 'DELETE'){
        try {
            let { ak, jobID } = await req.json();

            if (!verifyApiKey(ak)) {
                return {
                    statusCode: 401,
                    body: JSON.stringify({ error: 'Unauthorized' }),
                }
            }

            const cloudWatchClient = new CloudWatchEventsClient({ region: 'us-east-1' });


            await cloudWatchClient.send(new DeleteRuleCommand({
                Name:  `GENESISSCRON_${jobID}`,
                Force: true
            }));

            return NextResponse.json({
                statusCode: 200,
                body: JSON.stringify({ jobID: jobID, success: true }),
            })

        } catch (error) {
            console.error('Internal Jobs DELETE API Route Error:', error);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    }
}