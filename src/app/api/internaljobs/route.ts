import { NextRequest, NextResponse } from 'next/server';
import { Resource } from "sst";
import Cors from 'cors';
import { 
  searchMemory,
  addToMemory,
  internetChatAgent,
  simpleChatAgent,
  proChatAgent,
  smartCodeExecutionAgent,
  imageGenerationAgent,
  graphGenerationAgent,
  documentGenerationAgent,
  addToMemoryAgent,
  searchMemoryAgent,
  Agent,
  verifyApiKey,
} from '@/lib/utils';
import { CloudWatchEventsClient, DeleteRuleCommand } from '@aws-sdk/client-cloudwatch-events';

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

    if (req.method === 'POST'){
        try {
            let { ak, jobID, brainID, agents, callbackUrl, state } = await req.json();

            if (ak !== Resource.InternalAPIKey.value){
                return {
                    statusCode: 401,
                    body: JSON.stringify({ error: 'Unauthorized' }),
                }
            }

            const AgentToolbox = {
                internetChat: (prompt: string) => internetChatAgent(prompt),
                simpleChat: (prompt: string) => simpleChatAgent(prompt),
                proChat: (prompt: string) => proChatAgent(prompt),
                smartCodeExecution: (prompt: string) => smartCodeExecutionAgent(prompt),
                imageGeneration: (prompt: string) => imageGenerationAgent(prompt),
                graphGeneration: (prompt: string) => graphGenerationAgent(prompt),
                documentGeneration: (prompt: string) => documentGenerationAgent(prompt),
                addToMemory: (prompt: string, ak: string, brainID: string) => addToMemoryAgent(prompt, ak, brainID),
                searchMemory: (prompt: string, ak: string, brainID: string) => searchMemoryAgent(prompt, ak, brainID)
            }

            // Helper function to execute agents synchronously in order
            const executeAgentsSync = async (agentGroup: Agent[]) => {

                let calledAgents: CalledAgent[] = [];

                let agentGroupStore = 'Results from previous agents execution: \n\n'

                for (const agent of agentGroup) {
                if (AgentToolbox[agent.agent] && (AgentToolbox[agent.agent]!= addToMemory || AgentToolbox[agent.agent]!= searchMemory)) {
                    const result = await AgentToolbox[agent.agent](agent.prompt + agentGroupStore);
                    agentGroupStore += "Result from executing agent: " + agent.agent + "\n" + result + "\n\n";
                    calledAgents.push({ agent: agent.agent, result: result });
                } else if (AgentToolbox[agent.agent] && (AgentToolbox[agent.agent]== addToMemory || AgentToolbox[agent.agent]== searchMemory)) {
                    await AgentToolbox[agent.agent](agent.prompt, ak, brainID);
                    calledAgents.push({ agent: agent.agent, result: "Added to memory" });
                } else {
                    console.error(`Agent ${agent.agent} not found in AgentToolbox.`);
                }
                }

                return calledAgents;
            };

            const executedAgents = []

            // Execute agent groups asynchronously
            await Promise.all(
                agents.map(async (agentGroup) => {
                const calledAgents = await executeAgentsSync(agentGroup);
                executedAgents.push(calledAgents);
                })
            );

            // make an API call to the callback URL
            await fetch(callbackUrl, {
                method: 'POST',
                headers: {
                'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                jobID: jobID,
                state: state,
                agents: executedAgents,
                brainID: brainID
                }),
            });

            return NextResponse.json({
                statusCode: 200,
                body: JSON.stringify({ success: true }),
            })
        } catch (error) {
            console.error('Internal Jobs POST API Route Error:', error);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    } else {
        return NextResponse.json({ error: `Method ${req.method} Not Allowed` }, { status: 405 });
    }
}

export const DELETE = async (req: NextRequest, res: NextResponse) => {
    // Run CORS middleware
    await runMiddleware(req, res, cors);

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