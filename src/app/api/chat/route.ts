/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { Resource } from "sst";
import Cors from 'cors';
import { 
  verifyApiKey, 
  validateImages, 
  validateDocuments, 
  generateUniqueID, 
  searchMemory,  
  extractKeyFromS3Url,
  retrieveFromS3,
  getFileExtensionFromBase64,
  promptLLMWithConversation,
  promptLLM,
  searchInternetWithQueries,
  addMessageToChat,
  addToMemory
} from '@/lib/utils';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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

interface ChatRequest{
    ak: string, // api key
    message: string, // message
    internet: boolean,
    format: 'json' | 'markdown' | 'text',
    chatID?: string,
    brainID?: string[], // memory id, you can use additional brains in addition to ChatID brain,
    images?: string[], // array of base64-encoded image files
    documents?: string[], // array of base64-encoded document files
}

export const POST = async (req: NextRequest, res: NextResponse) => {
    
  const headers = handleCors(req);

    if (req.method === 'POST') {

        let { ak, message, internet, format, chatID, brainID, images, documents } = await req.json();

        try {
            
        if(!ak || !message || !internet){
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



        let newChat = false
        // create chatID if doesnt exist

        if (!chatID) {
            newChat = true
            chatID = generateUniqueID();
        }

        // if chatID was just created, skip this step, else search chatID memory and any other included memoryIDs

        let memorycontext = 'Retrieved Memories (if none, no relevant memories found):'

        if (!newChat && brainID){

            // search chatID memory
            const searchParams = {
                ak: ak,
                brainID: chatID,
            }

            const retrievedMem = await searchMemory(message, searchParams)

            memorycontext += '\n\n' + retrievedMem
            // create a params object for each of chatID, and all the other included brainIDs, for each of the params, call searchMemory

            for (const brain of brainID) {

                const searchMemoryParams = {
                    ak: ak,
                    brainID: brain
                }

                const retrievedMem = await searchMemory(message, searchMemoryParams)

                memorycontext += '\n\n' + retrievedMem
            }
        }


        // jina reranker (optional)

        // retrieve last n chats

        // Initialize DynamoDB client
        const dynamoDbClient = new DynamoDBClient({ region: 'us-east-1' });
        const documentClient = DynamoDBDocumentClient.from(dynamoDbClient);

        const TABLE_NAME = Resource.GenesissAPITable.name;

        let chatHistory = '';

        if (!newChat){
            const { Item } = await documentClient.send(
                new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { ak },
                })
            );

            // Check if the item and chats exist
            if (!Item || !Item.chats) {
                throw new Error('No chats found for this API key');
            }

            let formattedChats = '';

            const chat = Item.chats[chatID];

            // Iterate through each message in the chat
            for (const timestamp in chat.messages) {
                const messageObj = chat.messages[timestamp];

                // Extract the author and S3 URL from the message
                const { author, messageS3 } = messageObj;

                // Extract the S3 key from the messageS3 URL
                const s3Key = extractKeyFromS3Url(messageS3);

                // Retrieve the message content from S3
                const messageContent = await retrieveFromS3(s3Key!);

                // Append the author and message to the formatted string
                formattedChats += `${author}:\n\n${messageContent}\n\n`;
            }

            chatHistory = formattedChats;
        }


        // create LLM prompt: original q, last n chats, context, time and date of user

        let llmPrompt = "You are an AI agent with no specific identity. If you are asked to take or use a persona, you can. Otherwise, do not identify yourself.\n\nYou have been given the following prompt:\n\n"+message+"\n\nGenerate an answer to the prompt. Your answer MUST be in "+format+" format. If you have to return JSON, you are not allowed to return any extraneous content because your direct response will be parsed as JSON (meaning it will FAIL if you fail to return a stringified JSON). Some context that may be useful are previous memories:\n\n" + memorycontext + "\n\n and previous chats:\n\n"+ chatHistory + "\n\nIf these are empty then there are no previous chats or memories.";

        // if !internet, prompt llm to generate answer, store ans

        let finalLlmAnswer = '';

        if (!internet) {
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
            } else {
                const llmAnswer = await promptLLM(llmPrompt);

                finalLlmAnswer = llmAnswer;
            }
        } else if (internet) {

            let searchqueries = [];

            const oldllmPrompt = llmPrompt;
            llmPrompt = 
`BEGIN SYSTEM PROMPT: For the following prompt, generate a list of internet queries that would aid in answering the prompt. Construct good, specific questions because you aren't allowed to answer without citing sources. The current date is ${ new Date().toDateString }. Your response should be formatted like the following JSON (but make sure your JSON is stringified):
    {
        "queries": [
            "query 1",
            "query 2",
            "query 3", // etc, as needed. Soft limit is no more than 10 queries, hard limit is no more than 20 queries, but try to use less queries, but if you need more queries, add them as needed.
        ]
    }
END SYSTEM PROMPT

Prompt:
${oldllmPrompt}
`

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

                let internetContext = ''

                try {
                    const responseParsedJSON = JSON.parse(llmAnswer);
                    searchqueries = responseParsedJSON.queries;
                    internetContext = await searchInternetWithQueries(searchqueries);
                } catch (error) {
                    console.error("Failed to parse JSON:", error);
                    const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + llmAnswer);
                    try {
                        const responseParsedJSON = JSON.parse(fixedJSON);
                        searchqueries = responseParsedJSON.queries;
                        internetContext = await searchInternetWithQueries(searchqueries);
                    } catch (error) {
                        console.error("Failed to fix and parse JSON:", error);
                    }
                }

                const finalResponsePrompt =  "For the following prompt, you have the following Internet Context: All answers you provide must be backed with sources" + internetContext + "\n\n" + oldllmPrompt;

                conversation = [
                    {
                      role: "user" as const,
                      content: [{ text: finalResponsePrompt } as any],
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
                
                // Create the command with the model ID, conversation, and configuration
                const finalparams: ConverseCommandInput = {
                    modelId,
                    messages: conversation,
                    inferenceConfig: { maxTokens: 4096, temperature: 1, topP: 0.95 },
                }

                const finalLLMAnswer = await promptLLMWithConversation(finalparams);

                finalLlmAnswer = finalLLMAnswer;

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

                let internetContext = ''

                try {
                    const responseParsedJSON = JSON.parse(llmAnswer);
                    searchqueries = responseParsedJSON.queries;
                    internetContext = await searchInternetWithQueries(searchqueries);
                } catch (error) {
                    console.error("Failed to parse JSON:", error);
                    const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + llmAnswer);
                    try {
                        const responseParsedJSON = JSON.parse(fixedJSON);
                        searchqueries = responseParsedJSON.queries;
                        internetContext = await searchInternetWithQueries(searchqueries);
                    } catch (error) {
                        console.error("Failed to fix and parse JSON:", error);
                    }
                }

                const finalResponsePrompt =  "For the following prompt, you have the following Internet Context: All answers you provide must be backed with sources" + internetContext + "\n\n" + oldllmPrompt;

                conversation = [
                    {
                      role: "user" as const,
                      content: [{ text: finalResponsePrompt } as any],
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
                
                // Create the command with the model ID, conversation, and configuration
                const finalparams: ConverseCommandInput = {
                    modelId,
                    messages: conversation,
                    inferenceConfig: { maxTokens: 4096, temperature: 1, topP: 0.95 },
                }

                const finalLLMAnswer = await promptLLMWithConversation(finalparams);

                finalLlmAnswer = finalLLMAnswer;

                
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

                let internetContext = ''

                try {
                    const responseParsedJSON = JSON.parse(llmAnswer);
                    searchqueries = responseParsedJSON.queries;
                    internetContext = await searchInternetWithQueries(searchqueries);
                } catch (error) {
                    console.error("Failed to parse JSON:", error);
                    const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + llmAnswer);
                    try {
                        const responseParsedJSON = JSON.parse(fixedJSON);
                        searchqueries = responseParsedJSON.queries;
                        internetContext = await searchInternetWithQueries(searchqueries);
                    } catch (error) {
                        console.error("Failed to fix and parse JSON:", error);
                    }
                }

                const finalResponsePrompt =  "For the following prompt, you have the following Internet Context: All answers you provide must be backed with sources" + internetContext + "\n\n" + oldllmPrompt;

                conversation = [
                    {
                      role: "user" as const,
                      content: [{ text: finalResponsePrompt } as any],
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
                
                // Create the command with the model ID, conversation, and configuration
                const finalparams: ConverseCommandInput = {
                    modelId,
                    messages: conversation,
                    inferenceConfig: { maxTokens: 4096, temperature: 1, topP: 0.95 },
                }

                const finalLLMAnswer = await promptLLMWithConversation(finalparams);

                finalLlmAnswer = finalLLMAnswer;
            } else {
                const llmAnswer = await promptLLM(llmPrompt);

                let internetContext = ''

                try {
                    const responseParsedJSON = JSON.parse(llmAnswer);
                    searchqueries = responseParsedJSON.queries;
                    internetContext = await searchInternetWithQueries(searchqueries);
                } catch (error) {
                    console.error("Failed to parse JSON:", error);
                    const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + llmAnswer);
                    try {
                        const responseParsedJSON = JSON.parse(fixedJSON);
                        searchqueries = responseParsedJSON.queries;
                        internetContext = await searchInternetWithQueries(searchqueries);
                    } catch (error) {
                        console.error("Failed to fix and parse JSON:", error);
                    }
                }

                const finalResponsePrompt =  "For the following prompt, you have the following Internet Context: All answers you provide must be backed with sources" + internetContext + "\n\n" + oldllmPrompt;

                const finalLLMAnswer = await promptLLM(finalResponsePrompt);

                finalLlmAnswer = finalLLMAnswer;
            }
        }

        

        // if internet prompt llm to generate internet queries
        // use jina to search queries
        // use queries to generate internet answer
        // use internet answer + original prompt to generate final answer
        // store final answer

        // add user chat and final answer to db

        await addMessageToChat(ak, chatID, 'USER', message);
        await addMessageToChat(ak, chatID, 'AI RESPONSE', finalLlmAnswer);
        
        // vectorize user chat, store
        // vectorize final answer, store

        const addToMemoryParams = {
            ak: ak,
            brainID: chatID
        }

        await addToMemory(message, addToMemoryParams)
        await addToMemory(finalLlmAnswer, addToMemoryParams)

        // return final answer and chatID

        if (format === 'json') {
            try {
                finalLlmAnswer = JSON.parse(finalLlmAnswer);
            } catch (error) {
                console.error("Failed to parse JSON:", error);
                const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + finalLlmAnswer);
                try {
                    finalLlmAnswer = JSON.parse(fixedJSON);
                } catch (error) {
                    console.error("Failed to fix and parse JSON:", error);
                }
            }
        }

        const finalResponse = {
            chatID: chatID,
            message: finalLlmAnswer
        }

        return NextResponse.json({
            statusCode: 200,
            body: JSON.stringify(finalResponse),
        });


        } catch (error) {
            console.error('Chat API Route Error:', error);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    } else {
        return NextResponse.json({ error: `Method ${req.method} Not Allowed` }, { status: 405 });
    }
};