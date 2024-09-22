/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey, 
  validateImages, 
  validateDocuments, 
  getFileExtensionFromBase64,
  promptLLMWithConversation,
} from '@/lib/utils';
import {
  ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";

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

    // Run CORS middleware
    const headers = handleCors(req);

    if (req.method === 'POST') {
        
        try {
            
            let { ak, prompt, documents, images } = await req.json();
    
            if(!ak || !prompt || !(documents || images)){
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Bad Request' }),
                };
            }
    
            if(!await verifyApiKey(ak)){
                return {
                    statusCode: 401,
                    body: JSON.stringify({ error: 'Unauthorized' }),
                };
            }
    
            let llmPrompt = "You are an AI agent with no specific identity. If you are asked to take or use a persona, you can. Otherwise, do not identify yourself.\n\nYou have been given the following prompt and attached documents:\n\n"+prompt+"\n\nGenerate an answer to the prompt.";
    
            let finalLlmAnswer = '';
    
            // Validate images if present
            if (images) {
                const imageError = validateImages(images);
                if (imageError) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: imageError }),
                    };
                }
            }
    
            // Validate documents if present
            if (documents) {
                const documentError = validateDocuments(documents);
                if (documentError) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: documentError }),
                    };
                }
            }
    
            if (images && documents) {
                let conversation = [
                    {
                      role: "user" as const,
                      content: [{ text: llmPrompt } as any],
                    }
                ]
    
                for (const image of images) {
                    conversation.push({
                        role: "user",
                        content: [{
                          image: {
                            format: getFileExtensionFromBase64(image), // Extract format from MIME type
                            source: {
                              bytes: image,
                            }
                          }
                        }]
                    })
                }
    
                for (const document of documents) {
                    conversation.push({
                        role: "user",
                        content: [{
                          document: {
                            format: getFileExtensionFromBase64(document), // Extract format from MIME type
                            source: {
                              bytes: document,
                            }
                          }
                        }]
                      });
                }
                // Set the model ID, e.g., Claude 3 Haiku.
                const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
                // Create the command with the model ID, conversation, and configuration
                const params: ConverseCommandInput = {
                    modelId,
                    messages: conversation,
                    inferenceConfig: { maxTokens: 4096, temperature: 1, topP: 0.95 },
                }
    
                const llmAnswer = await promptLLMWithConversation(params);
    
                finalLlmAnswer = llmAnswer;
    
            } else if (images) {
                let conversation = [
                    {
                      role: "user" as const,
                      content: [{ text: llmPrompt } as any],
                    },
                ];
    
                for (const image of images) {
                    conversation.push({
                        role: "user",
                        content: [{
                          image: {
                            format: getFileExtensionFromBase64(image), // Extract format from MIME type
                            source: {
                              bytes: image,
                            }
                          }
                        }]
                      });
                }
    
                // Set the model ID, e.g., Claude 3 Haiku.
                const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
                // Create the command with the model ID, conversation, and configuration
                const params: ConverseCommandInput = {
                    modelId,
                    messages: conversation,
                    inferenceConfig: { maxTokens: 4096, temperature: 1, topP: 0.95 },
                }
    
                const llmAnswer = await promptLLMWithConversation(params);
    
                finalLlmAnswer = llmAnswer;
    
                
            } else if (documents) {
                let conversation = [
                    {
                      role: "user" as const,
                      content: [{ text: llmPrompt } as any],
                    }
                ]
    
                for (const document of documents) {
                    conversation.push({
                        role: "user",
                        content: [{
                          document: {
                            format: getFileExtensionFromBase64(document), // Extract format from MIME type
                            source: {
                              bytes: document,
                            }
                          }
                        }]
                      });
                }
                // Set the model ID, e.g., Claude 3 Haiku.
                const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
                // Create the command with the model ID, conversation, and configuration
                const params: ConverseCommandInput = {
                    modelId,
                    messages: conversation,
                    inferenceConfig: { maxTokens: 4096, temperature: 1, topP: 0.95 },
                }
    
                const llmAnswer = await promptLLMWithConversation(params);
    
                finalLlmAnswer = llmAnswer;
            }
            
    
    
            return NextResponse.json({
                statusCode: 200,
                body: JSON.stringify({ response: finalLlmAnswer }),
            });
    
        } catch (error) {
            console.error("DocuGen Endpoint error: " + JSON.stringify(error, null, 2))
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