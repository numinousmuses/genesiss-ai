import { v4 as uuidv4 } from 'uuid';
import axios from "axios";
import { Resource, VectorClient } from "sst";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import * as stream from 'stream';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    BedrockRuntimeClient,
    ConverseCommand,
    ConverseCommandInput,
  } from "@aws-sdk/client-bedrock-runtime";
import Replicate from 'replicate';
import { createCanvas } from "canvas";
import { Chart, ChartItem } from "chart.js/auto";

import { LambdaClient, CreateFunctionCommand, AddPermissionCommand } from '@aws-sdk/client-lambda';
import { CloudWatchEventsClient, PutRuleCommand, PutTargetsCommand } from '@aws-sdk/client-cloudwatch-events';
import PDFDocument from 'pdfkit';
import markdownIt from 'markdown-it';

const JINA_API_URL = "https://api.jina.ai/v1/embeddings";
const JINA_API_KEY = Resource.JinaApiKey.value; // Replace with your actual API key
const MAX_TOKENS_PER_CHUNK = 8000; // Set the maximum tokens per chunk
const MAX_TEXTS_PER_CALL = 2048;   // Set the maximum texts per API call

// List of allowed document file types
const allowedDocumentExtensions = ['pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'html', 'txt', 'md'];

// Maximum allowed sizes and counts
const MAX_IMAGE_SIZE_MB = 3.75; // in MB
const MAX_DOCUMENT_SIZE_MB = 4.5; // in MB
const MAX_IMAGES_COUNT = 20;
const MAX_DOCUMENTS_COUNT = 5;

// Helper function to check the size of base64 content
const getBase64SizeInMB = (base64string: string): number => {
    const buffer = Buffer.from(base64string, 'base64');
    return buffer.length / (1024 * 1024); // Convert bytes to MB
};

// Helper function to get the file extension from base64 data URL
export const getFileExtensionFromBase64 = (base64string: string): string => {
    const matches = base64string.match(/^data:(.*);base64,/);
    if (matches) {
        const mimeType = matches[1];
        return mimeType.split('/')[1]; // Extract extension from MIME type
    }
    return '';
};

// Function to validate the images based on size and dimensions
export const validateImages = (images: string[]): string | null => {
    if (images.length > MAX_IMAGES_COUNT) {
        return `Too many images. Maximum allowed is ${MAX_IMAGES_COUNT}.`;
    }

    for (const base64Image of images) {
        const imageSizeMB = getBase64SizeInMB(base64Image);
        if (imageSizeMB > MAX_IMAGE_SIZE_MB) {
            return `One or more images exceed the size limit of ${MAX_IMAGE_SIZE_MB} MB.`;
        }

        // Optionally, you can implement image dimension checks if you have access to a function
        // that can decode base64 and read dimensions (this would involve image libraries).
        // Example using a mock function:
        // const { width, height } = getImageDimensions(base64Image);
        // if (width > MAX_IMAGE_DIMENSIONS_PX || height > MAX_IMAGE_DIMENSIONS_PX) {
        //     return `One or more images exceed the dimension limit of ${MAX_IMAGE_DIMENSIONS_PX}px.`;
        // }
    }

    return null;
};

// Function to validate the documents based on size and file type
export const validateDocuments = (documents: string[]): string | null => {
    if (documents.length > MAX_DOCUMENTS_COUNT) {
        return `Too many documents. Maximum allowed is ${MAX_DOCUMENTS_COUNT}.`;
    }

    for (const base64Document of documents) {
        const documentSizeMB = getBase64SizeInMB(base64Document);
        if (documentSizeMB > MAX_DOCUMENT_SIZE_MB) {
            return `One or more documents exceed the size limit of ${MAX_DOCUMENT_SIZE_MB} MB.`;
        }

        const documentExtension = getFileExtensionFromBase64(base64Document);
        if (!allowedDocumentExtensions.includes(documentExtension)) {
            return `Invalid document type. Allowed types are: ${allowedDocumentExtensions.join(', ')}.`;
        }
    }

    return null;
};

export interface Results {
    metadata: Record<string, any>;
    score: number;
}[]

// searchmem( brainID, ak, tags[])

export interface ChatRequest{
    ak: string, // api key
    message: string, // message
    internet: boolean,
    format: 'json' | 'markdown' | 'text',
    chatID?: string,
    brainID?: string[], // memory id, you can use additional brains in addition to ChatID brain,
    images?: string[], // array of base64-encoded image files
    documents?: string[], // array of base64-encoded document files
}

// ███╗░░░███╗███████╗███╗░░░███╗░█████╗░██████╗░██╗░░░██╗  ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ████╗░████║██╔════╝████╗░████║██╔══██╗██╔══██╗╚██╗░██╔╝  ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// ██╔████╔██║█████╗░░██╔████╔██║██║░░██║██████╔╝░╚████╔╝░  █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██║╚██╔╝██║██╔══╝░░██║╚██╔╝██║██║░░██║██╔══██╗░░╚██╔╝░░  ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ██║░╚═╝░██║███████╗██║░╚═╝░██║╚█████╔╝██║░░██║░░░██║░░░  ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚═╝░░░░░╚═╝╚══════╝╚═╝░░░░░╚═╝░╚════╝░╚═╝░░╚═╝░░░╚═╝░░░  ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

// add memory
// get specific memory/memories with memoryID
// delete memory
// query memory

export interface MemoryParams {
    ak: string;
    brainID: string[]; // if one brainID, all the memories in content are added to the brainID, otherwise the memories in content are added to their corresponding brainIDs, same for queries
    task: 'add' | 'delete' | 'query';
    content?: string[]; // if query, these are your queries, if add, these are your memories, if get, nonexistent, if delete, nonexistent
    numResults?: number[];
    threshold?: number[];
    metadata?: Record<string, string>[];
    excludeMetadata?: Record<string, string>[];
}


// ░░░░░██╗░█████╗░██████╗░░██████╗  ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ░░░░░██║██╔══██╗██╔══██╗██╔════╝  ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// ░░░░░██║██║░░██║██████╦╝╚█████╗░  █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╗░░██║██║░░██║██╔══██╗░╚═══██╗  ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ╚█████╔╝╚█████╔╝██████╦╝██████╔╝  ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ░╚════╝░░╚════╝░╚═════╝░╚═════╝░  ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

// Hourly Schedules (every hour, every N minutes)
// Daily Schedules (specific times each day)
// Weekly Schedules (specific days of the week)
// Monthly Schedules (specific days of the month)
// Yearly Schedules (specific years)
// Combination of Specific Days, Months, and Times
// Interval Schedules (e.g., every N days)
// Last Day of the Month

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


// ██╗███╗░░██╗████████╗███████╗██████╗░███╗░░██╗░█████╗░██╗░░░░░  ░░░░░██╗░█████╗░██████╗░░██████╗
// ██║████╗░██║╚══██╔══╝██╔════╝██╔══██╗████╗░██║██╔══██╗██║░░░░░  ░░░░░██║██╔══██╗██╔══██╗██╔════╝
// ██║██╔██╗██║░░░██║░░░█████╗░░██████╔╝██╔██╗██║███████║██║░░░░░  ░░░░░██║██║░░██║██████╦╝╚█████╗░
// ██║██║╚████║░░░██║░░░██╔══╝░░██╔══██╗██║╚████║██╔══██║██║░░░░░  ██╗░░██║██║░░██║██╔══██╗░╚═══██╗
// ██║██║░╚███║░░░██║░░░███████╗██║░░██║██║░╚███║██║░░██║███████╗  ╚█████╔╝╚█████╔╝██████╦╝██████╔╝
// ╚═╝╚═╝░░╚══╝░░░╚═╝░░░╚══════╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝░░╚═╝╚══════╝  ░╚════╝░░╚════╝░╚═════╝░╚═════╝░

export interface InternalJobsRequest {
    ak: string,
    jobID: string,
    brainID: string,
    agents: Agent[][],
    callbackUrl: string,
    state?: string,
}

export interface CalledAgent {
    agent: string,
    result: string,
}

export interface InternalJobRequestResponse {
    jobID: string,
    brainID: string,
    agents: CalledAgent[][],
    state?: string,
}

export interface DeleteJobRequest {
    ak: string,
    jobID: string,
}

export interface DeleteJobResponse {
    jobID: string,
    success: boolean,
}


// ██████╗░███████╗██╗░░░░░███████╗████████╗███████╗  ░░░░░██╗░█████╗░██████╗░░██████╗
// ██╔══██╗██╔════╝██║░░░░░██╔════╝╚══██╔══╝██╔════╝  ░░░░░██║██╔══██╗██╔══██╗██╔════╝
// ██║░░██║█████╗░░██║░░░░░█████╗░░░░░██║░░░█████╗░░  ░░░░░██║██║░░██║██████╦╝╚█████╗░
// ██║░░██║██╔══╝░░██║░░░░░██╔══╝░░░░░██║░░░██╔══╝░░  ██╗░░██║██║░░██║██╔══██╗░╚═══██╗
// ██████╔╝███████╗███████╗███████╗░░░██║░░░███████╗  ╚█████╔╝╚█████╔╝██████╦╝██████╔╝
// ╚═════╝░╚══════╝╚══════╝╚══════╝░░░╚═╝░░░╚══════╝  ░╚════╝░░╚════╝░╚═════╝░╚═════╝░

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░



// ██╗███╗░░██╗████████╗███████╗██████╗░███╗░░██╗███████╗████████╗  ░█████╗░██╗░░██╗░█████╗░████████╗
// ██║████╗░██║╚══██╔══╝██╔════╝██╔══██╗████╗░██║██╔════╝╚══██╔══╝  ██╔══██╗██║░░██║██╔══██╗╚══██╔══╝
// ██║██╔██╗██║░░░██║░░░█████╗░░██████╔╝██╔██╗██║█████╗░░░░░██║░░░  ██║░░╚═╝███████║███████║░░░██║░░░
// ██║██║╚████║░░░██║░░░██╔══╝░░██╔══██╗██║╚████║██╔══╝░░░░░██║░░░  ██║░░██╗██╔══██║██╔══██║░░░██║░░░
// ██║██║░╚███║░░░██║░░░███████╗██║░░██║██║░╚███║███████╗░░░██║░░░  ╚█████╔╝██║░░██║██║░░██║░░░██║░░░
// ╚═╝╚═╝░░╚══╝░░░╚═╝░░░╚══════╝╚═╝░░╚═╝╚═╝░░╚══╝╚══════╝░░░╚═╝░░░  ░╚════╝░╚═╝░░╚═╝╚═╝░░╚═╝░░░╚═╝░░░

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface InternetChatRequest {
    ak: string,
    prompt: string,
    pro: boolean
}

export interface InternetChatResponse {
    response: string
}

export async function ichat(event: APIGatewayProxyEvent){
    try {
        const body = JSON.parse(event.body);

        let { ak, prompt, pro } = body as InternetChatRequest;

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

    } catch(error) {
        console.error("Internet Chat Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }


}


// ░█████╗░░█████╗░██████╗░███████╗  ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔══██╗██╔══██╗██╔══██╗██╔════╝  ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// ██║░░╚═╝██║░░██║██║░░██║█████╗░░  █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██║░░██╗██║░░██║██║░░██║██╔══╝░░  ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ╚█████╔╝╚█████╔╝██████╔╝███████╗  ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ░╚════╝░░╚════╝░╚═════╝░╚══════╝  ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface CodeRequest {
    ak: string,
    prompt: string,
}

export interface SmartCodeExecResponse{
    ranCode: RanCode[],
    conclusion: string
}

export interface RanCode {
    code: string,
    stdout: string
}

export async function code(event: APIGatewayProxyEvent){
    try {
        const body = JSON.parse(event.body);

        let { ak, prompt } = body as CodeRequest;

        if (!ak || !prompt) {
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

        const res = await smartCodeExecutionAgent(prompt)

        return {
            statusCode: 200,
            body: JSON.stringify({response: res}),
        };


    } catch (error) {
        console.error("Code Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }
}


// ░██████╗░██████╗░░█████╗░██████╗░██╗░░██╗░██████╗░███████╗███╗░░██╗
// ██╔════╝░██╔══██╗██╔══██╗██╔══██╗██║░░██║██╔════╝░██╔════╝████╗░██║
// ██║░░██╗░██████╔╝███████║██████╔╝███████║██║░░██╗░█████╗░░██╔██╗██║
// ██║░░╚██╗██╔══██╗██╔══██║██╔═══╝░██╔══██║██║░░╚██╗██╔══╝░░██║╚████║
// ╚██████╔╝██║░░██║██║░░██║██║░░░░░██║░░██║╚██████╔╝███████╗██║░╚███║
// ░╚═════╝░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░░░░╚═╝░░╚═╝░╚═════╝░╚══════╝╚═╝░░╚══╝

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface GraphGenRequest {
    ak: string,
    prompt: string,
    height?: number,
    width?: number
}

export interface GraphGenResponse {
    graphURL: string
}

export async function graphgen(event: APIGatewayProxyEvent){
    try {
        const body = JSON.parse(event.body);

        let { ak, prompt, height, width } = body as GraphGenRequest;

        if (!ak || !prompt) {
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

        const res = await graphGenerationAgent(prompt, height, width)

        return {
            statusCode: 200,
            body: JSON.stringify({response: res}),
        };

    } catch (error) {
        console.error("GraphGen Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }
}


// ██████╗░░█████╗░░█████╗░██╗░░░██╗░█████╗░░█████╗░███╗░░░███╗██████╗░
// ██╔══██╗██╔══██╗██╔══██╗██║░░░██║██╔══██╗██╔══██╗████╗░████║██╔══██╗
// ██║░░██║██║░░██║██║░░╚═╝██║░░░██║██║░░╚═╝██║░░██║██╔████╔██║██████╔╝
// ██║░░██║██║░░██║██║░░██╗██║░░░██║██║░░██╗██║░░██║██║╚██╔╝██║██╔═══╝░
// ██████╔╝╚█████╔╝╚█████╔╝╚██████╔╝╚█████╔╝╚█████╔╝██║░╚═╝░██║██║░░░░░
// ╚═════╝░░╚════╝░░╚════╝░░╚═════╝░░╚════╝░░╚════╝░╚═╝░░░░░╚═╝╚═╝░░░░░

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface DocuCompRequest{
    ak: string,
    prompt: string,
    documents?: string[], // array of base64-encoded image files
    images?: string[], // array of base64-encoded document files
}

export interface DocuGenResponse{
    response: string
}

export async function docucomp(event: APIGatewayProxyEvent){
    try {
        
        const body = JSON.parse(event.body);

        let { ak, prompt, documents, images } = body as DocuCompRequest;

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
        


        return {
            statusCode: 200,
            body: JSON.stringify({ response: finalLlmAnswer }),
        };

    } catch (error) {
        console.error("DocuGen Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }
}


// ░██████╗██╗███╗░░░███╗██████╗░██╗░░░░░███████╗  ░█████╗░██╗░░██╗░█████╗░████████╗
// ██╔════╝██║████╗░████║██╔══██╗██║░░░░░██╔════╝  ██╔══██╗██║░░██║██╔══██╗╚══██╔══╝
// ╚█████╗░██║██╔████╔██║██████╔╝██║░░░░░█████╗░░  ██║░░╚═╝███████║███████║░░░██║░░░
// ░╚═══██╗██║██║╚██╔╝██║██╔═══╝░██║░░░░░██╔══╝░░  ██║░░██╗██╔══██║██╔══██║░░░██║░░░
// ██████╔╝██║██║░╚═╝░██║██║░░░░░███████╗███████╗  ╚█████╔╝██║░░██║██║░░██║░░░██║░░░
// ╚═════╝░╚═╝╚═╝░░░░░╚═╝╚═╝░░░░░╚══════╝╚══════╝  ░╚════╝░╚═╝░░╚═╝╚═╝░░╚═╝░░░╚═╝░░░

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface SchatRequest {
    ak: string;
    prompt: string;
}

export interface SchatResponse {
    response: string;
}

export async function schat(event){
    try {
        
        const body = JSON.parse(event.body);

        let { ak, prompt } = body as SchatRequest;

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

        return {
            statusCode: 200,
            body: JSON.stringify({ response: response }),
        };


    } catch (error) {
        console.error("Schat Endpoint error: " + JSON.stringify(error, null, 2))
        console.log("Schat Endpoint error: " + error)
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'This is the error' }),
        }
    }
}


// ██████╗░░█████╗░░█████╗░██╗░░░██╗░██████╗░███████╗███╗░░██╗
// ██╔══██╗██╔══██╗██╔══██╗██║░░░██║██╔════╝░██╔════╝████╗░██║
// ██║░░██║██║░░██║██║░░╚═╝██║░░░██║██║░░██╗░█████╗░░██╔██╗██║
// ██║░░██║██║░░██║██║░░██╗██║░░░██║██║░░╚██╗██╔══╝░░██║╚████║
// ██████╔╝╚█████╔╝╚█████╔╝╚██████╔╝╚██████╔╝███████╗██║░╚███║
// ╚═════╝░░╚════╝░░╚════╝░░╚═════╝░░╚═════╝░╚══════╝╚═╝░░╚══╝

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface DocuGenRequest{
    ak: string;
    prompt: string;
}

export interface DocuGenResponse{
    documentURL: string;
}

export async function docugen(event: APIGatewayProxyEvent){
    try {
        
        const body = JSON.parse(event.body);

        let { ak, prompt } = body as DocuGenRequest;

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

        const response = await documentGenerationAgent(prompt)

        return {
            statusCode: 200,
            body: JSON.stringify({ documentURL: response }),
        };

    } catch (error) {
        console.error("DocuGen Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }
}


// ░█████╗░░█████╗░██████╗░██╗███╗░░░███╗░█████╗░░██████╗░███████╗
// ██╔══██╗██╔══██╗██╔══██╗██║████╗░████║██╔══██╗██╔════╝░██╔════╝
// ██║░░██║██║░░╚═╝██████╔╝██║██╔████╔██║███████║██║░░██╗░█████╗░░
// ██║░░██║██║░░██╗██╔══██╗██║██║╚██╔╝██║██╔══██║██║░░╚██╗██╔══╝░░
// ╚█████╔╝╚█████╔╝██║░░██║██║██║░╚═╝░██║██║░░██║╚██████╔╝███████╗
// ░╚════╝░░╚════╝░╚═╝░░╚═╝╚═╝╚═╝░░░░░╚═╝╚═╝░░╚═╝░╚═════╝░╚══════╝

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface OCRImageRequest{
    ak: string;
    imageURL: string;
}

export interface OCRImageResponse{
    text: string;
}

export async function ocrimage(event: APIGatewayProxyEvent){
    try {
        
        const body = JSON.parse(event.body);

        let { ak, imageURL } = body as OCRImageRequest;

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
        
        export interface GenericO {
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

        return {
            statusCode: 200,
            body: JSON.stringify({ text: text }),
        }

          
          
    } catch (error) {
        console.error("OCRImage Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }
}


// ██╗███╗░░░███╗░█████╗░░██████╗░███████╗░██████╗░███████╗███╗░░██╗
// ██║████╗░████║██╔══██╗██╔════╝░██╔════╝██╔════╝░██╔════╝████╗░██║
// ██║██╔████╔██║███████║██║░░██╗░█████╗░░██║░░██╗░█████╗░░██╔██╗██║
// ██║██║╚██╔╝██║██╔══██║██║░░╚██╗██╔══╝░░██║░░╚██╗██╔══╝░░██║╚████║
// ██║██║░╚═╝░██║██║░░██║╚██████╔╝███████╗╚██████╔╝███████╗██║░╚███║
// ╚═╝╚═╝░░░░░╚═╝╚═╝░░╚═╝░╚═════╝░╚══════╝░╚═════╝░╚══════╝╚═╝░░╚══╝

// ███████╗███╗░░██╗██████╗░██████╗░░█████╗░██╗███╗░░██╗████████╗
// ██╔════╝████╗░██║██╔══██╗██╔══██╗██╔══██╗██║████╗░██║╚══██╔══╝
// █████╗░░██╔██╗██║██║░░██║██████╔╝██║░░██║██║██╔██╗██║░░░██║░░░
// ██╔══╝░░██║╚████║██║░░██║██╔═══╝░██║░░██║██║██║╚████║░░░██║░░░
// ███████╗██║░╚███║██████╔╝██║░░░░░╚█████╔╝██║██║░╚███║░░░██║░░░
// ╚══════╝╚═╝░░╚══╝╚═════╝░╚═╝░░░░░░╚════╝░╚═╝╚═╝░░╚══╝░░░╚═╝░░░

export interface ImageGenRequest{
    ak: string,
    prompt: string,
    height?: number,
    width?: number
}

export interface ImageGenResponse{
    imageeURL: string
}

export async function imagegen(event: APIGatewayProxyEvent){
    try {
        
        const body = JSON.parse(event.body);

        const { ak, prompt, height, width } = body as ImageGenRequest;

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

        return {
            statusCode: 200,
            body: JSON.stringify({ imageeURL: res }),
        }

    } catch (error) {
        console.error("ImageGen Endpoint error: " + JSON.stringify(error, null, 2))
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }
    }
}

// example search memory call
// {
//     "query": "What is the capital of France?",
//     "metadata": {
//       "ak": "your-api-key",
//       "brainID": "12345",
//       "someOtherField": "someValue"
//     }
//   }

export async function deleteMemory(brainID: string, ak: string, metadata: Record<string, string>): Promise<void> {
    
    if (!metadata.ak || !metadata.brainID) {
        throw new Error("Metadata must contain 'ak' and 'brainID'");
    }
    
    const client = VectorClient("GenesissVectorDB");

    const deleteParams = {
        ak: ak,
        brainID: brainID,
        ...metadata
    }

    await client.remove({
        include: deleteParams,
    })
}

export async function verifyApiKey(apiKey: string): Promise<boolean> {
    // simulate working, implement later
    return true;
}

export function generateUniqueID(): string {
    const uuid = uuidv4();
    return uuid.replace(/-/g, '');
}

// Helper function to split text into chunks
export function chunkText(text: string, maxTokensPerChunk: number): string[] {
    // Implement a simple text chunking based on token size (in this case, word count)
    const words = text.split(" ");
    const chunks: string[] = [];
    let chunk: string[] = [];

    words.forEach((word) => {
        if (chunk.join(" ").length + word.length > maxTokensPerChunk) {
        chunks.push(chunk.join(" "));
        chunk = [];
        }
        chunk.push(word);
    });

    // Push the last chunk
    if (chunk.length > 0) {
        chunks.push(chunk.join(" "));
    }

    return chunks;
}


export async function generateEmbeddings(text: string): Promise<number[][]> {
    // Split the text into manageable chunks
    const chunks = chunkText(text, MAX_TOKENS_PER_CHUNK*4);
    const chunkBatches: string[][] = [];

    // Prepare batches of texts for API calls (as Jina allows up to 2048 texts per call)
    for (let i = 0; i < chunks.length; i += MAX_TEXTS_PER_CALL) {
        chunkBatches.push(chunks.slice(i, i + MAX_TEXTS_PER_CALL));
    }

    const embeddings: number[][] = [];

    // Process each batch of chunks
    for (const batch of chunkBatches) {
        try {
        const response = await axios.post(
            JINA_API_URL,
            {
            model: "jina-embedding-v2",
            normalized: true,
            embedding_type: "float",
            input: batch.map((textChunk) => ({ text: textChunk })),
            },
            {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${JINA_API_KEY}`,
            },
            }
        );

        // Extract embeddings from the response and append to the results
        const resultEmbeddings = response.data.data.map((item: any) => item.embedding);
        embeddings.push(...resultEmbeddings);
        } catch (error) {
            console.error("Error generating embeddings from Jina API", error);
            throw new Error("Failed to generate embeddings");
        }
    }   

    return embeddings;
}

// searchmem( brainID, ak, tags[])
// first tag must be brainID

// metadata should be at least two elements, first is ak, second is brainID, then arbitrary other ones. Making this into an export interface:

export interface Results {
    metadata: Record<string, any>;
    score: number;
}[]


export async function searchMemory(query: string, metadata: Record<string, any>, excludeMetadata?: Record<string, any>): Promise<string> {

    if (!metadata.ak || !metadata.brainID) {
        throw new Error("Metadata must contain 'ak' and 'brainID'");
    }

    const client = VectorClient("GenesissVectorDB");

    let results = `QUERYING with QUERY:\n${query} has results: \n`;

    const embeddings = await generateEmbeddings(query);

    for (const embedding of embeddings) {
        // Dynamically build the include param from the metadata object

        let queryParams = {
            vector: embedding,
            include: metadata,  // Include the arbitrary metadata provided
        };

        if (excludeMetadata) {
            queryParams["exclude"] = excludeMetadata;
        }

        const qresult = await client.query(queryParams);

        for (const res of qresult.results) {
            const url = res.metadata.contentS3
            const key = extractKeyFromS3Url(url)
            const strres = retrieveFromS3(key)

            results += `A RETRIEVED MEMORY::\n${JSON.stringify(strres)}\n\n`;
        }

    }

    return results;
}

export interface QueryResult {
    metadata: {
        brainID: string;
        content: string;
        [key: string]: any;
    };
    score: number;
}

export interface QueryResultHidden {
    metadata: Record<string, any>;
    score: number;
}

export async function searchMemoryAdvanced(query: string, metadata: Record<string, any>, excludeMetadata?: Record<string, any>, extraParams?: Record<string, any>): Promise<QueryResult[]> {

    if (!metadata.ak || !metadata.brainID) {
        throw new Error("Metadata must contain 'ak' and 'brainID'");
    }

    const client = VectorClient("GenesissVectorDB");

    let results: QueryResult[]

    const embeddings = await generateEmbeddings(query);

    for (const embedding of embeddings) {
        // Dynamically build the include param from the metadata object

        let queryParams = {
            vector: embedding,
            include: metadata,  // Include the arbitrary metadata provided
        };

        if (excludeMetadata) {
            queryParams["exclude"] = excludeMetadata;
        }

        if (extraParams) {
            queryParams = {...queryParams, ...extraParams};
        }

        const qresult = await client.query(queryParams);

        for (const res of qresult.results) {
            const url = res.metadata.contentS3
            const key = extractKeyFromS3Url(url)
            const strres = await retrieveFromS3(key)

            const {contentS3, brainID, ak, ...newMetadata} = res.metadata

            export interface specificMetadata {
                brainID: string;
                memoryID: string;
                content: string;
                [key: string]: any;
            }

            const individualResultFormatted: QueryResult = {
                
                metadata: {
                    brainID: brainID,
                    content: strres,
                    ...newMetadata
                },
                score: res.score
            }

            results.push(individualResultFormatted);
        }

    }

    return results;
}

export async function addToMemory(memory: string, metadata: Record<string, any>): Promise<void> {

    if (!metadata.ak || !metadata.brainID) {
        throw new Error("Metadata must contain 'ak' and 'brainID'");
    }

    try {
        const client = VectorClient("GenesissVectorDB");

        const chunkedMemory = chunkText(memory, MAX_TOKENS_PER_CHUNK);

        let iterator = 0;

        const embeddings = await generateEmbeddings(memory);

        for (const embedding of embeddings) {
            const contentS3 = await addToS3(chunkedMemory[iterator]);

            // Dynamically build the include param from the metadata object
            await client.put({
                vector: embedding,
                metadata: {
                    contentS3: contentS3,
                    ...metadata,  // Include the arbitrary metadata provided
                },
            });

            iterator++;
        }

        
    } catch (error) {

        console.error(error);
    }

}


export const addToS3 = async (data: any, isParams?: boolean, isPublicBucket?: boolean, key2use?: string): Promise<string> => {
    try {
        let BUCKET_NAME: string;

        if (isPublicBucket) {
            BUCKET_NAME = Resource.GenesissPublicBucket.name;
        } else {
            BUCKET_NAME = Resource.GenesissBucket.name;
        }

        const client = new S3Client({ region: 'us-east-1' });

        // Generate a unique key for the S3 object if not provided
        const uniqueKey = key2use ? key2use : `${uuidv4()}`.replace(/-/g, "");

        let body: Buffer;
        let contentType: string;

        // Handle base64 encoded file or plain text data
        if (typeof data === "object") {
            // Assuming object means JSON data
            body = Buffer.from(JSON.stringify(data));
            contentType = "application/json";
        } else if (typeof data === "string") {
            // Check if the string is base64-encoded or just plain text
            if (isBase64(data)) {
                // If base64 encoded, decode to binary and set proper content type
                body = Buffer.from(data, 'base64');
                contentType = key2use?.endsWith('.png') ? 'image/png' :
                              key2use?.endsWith('.pdf') ? 'application/pdf' :
                              'application/octet-stream'; // Fallback for unknown types
            } else {
                // If plain text
                body = Buffer.from(data);
                contentType = "text/plain";
            }
        } else {
            throw new Error("Unsupported data type. Data must be an object or a string.");
        }

        // Define the parameters for the S3 PutObjectCommand
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: uniqueKey,
            Body: body,
            ContentType: contentType,
        });

        // Upload the data to S3
        await client.send(command);

        // Construct the S3 URL
        const s3Url = `https://${BUCKET_NAME}.s3.amazonaws.com/${uniqueKey}`;

        return s3Url;
    } catch (error) {
        console.error('Error uploading data to S3:', error);
        throw new Error('Failed to upload data to S3');
    }
};

// Utility function to check if a string is base64 encoded
export const isBase64 = (str: string): boolean => {
    try {
        return Buffer.from(str, 'base64').toString('base64') === str.trim();
    } catch (err) {
        return false;
    }
};


export const streamTostring = (stream: stream.Readable): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
});
  
export const retrieveFromS3 = async (key: string): Promise<string> => {
    const client = new S3Client({region: 'us-east-1'});
    const params = {
      Bucket: Resource.GenesissBucket.name,
      Key: key,
    };
  
    try {
      const command = new GetObjectCommand(params);
      const { Body } = await client.send(command);
  
      if (Body instanceof stream.Readable) {
        const data = await streamTostring(Body);
        try {
          return JSON.parse(data);
        } catch {
          return data;
        }
      } else {
        throw new Error("Unexpected data type for S3 object body");
      }
    } catch (error) {
      console.error("Error retrieving from S3:", error);
      throw new Error("Error retrieving from S3");
    }
};

export function extractKeyFromS3Url(s3Url: string): string | null {
    const regex = /^https:\/\/[a-zA-Z0-9.-]+\.s3\.amazonaws\.com\/(.+)$/;
    const match = s3Url.match(regex);
    return match ? match[1] : null;
}

export async function promptLLM(prompt: string, model?: string): Promise<string> {
    const retryCount = 3;
    const client = new BedrockRuntimeClient({ region: "us-east-1" });
    let modelId
     
  
     if (model === "sonnet"){
      modelId = "anthropic.claude-3-sonnet-20240229-v1:0";
     } else if (model === "llama"){
      modelId = "meta.llama3-1-70b-instruct-v1:0";
     } else { 
      modelId = "anthropic.claude-3-haiku-20240307-v1:0" 
      // modelId = "anthropic.claude-3-sonnet-20240229-v1:0";
     }
    
  
    const conversation = [
      {
        role: "user" as const,
        content: [{ text: prompt }],
      },
    ];
  
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        const response = await client.send(
          new ConverseCommand({ modelId, messages: conversation, inferenceConfig: { maxTokens: modelId == "meta.llama3-1-70b-instruct-v1:0" ? 2048 : 4096 } }),
        );
  
        console.log("\n\n\n\n\n\n\n\n\n\n\n")
        console.log("RESPONSE OUTPUT MESSAGE:")
        console.log(JSON.stringify(response!.output!.message, null, 2))
        console.log("\n\n\n\n\n\n\n\n\n\n\n")
   
  
        let responseText;
  
        if (response?.output?.message?.content?.[0]?.text) {
          responseText = response.output.message.content[0].text;
        }
  
        if (responseText) {
          return responseText;
        } else {
          return "No response from LLM/Error getting LLM response";
        }
      } catch (error) {
        console.error(`Error getting LLM response (attempt ${attempt + 1}/${retryCount}):`, error);
  
        if (attempt === retryCount - 1) {
          return "Error getting LLM response after multiple attempts";
        }
  
        // Calculate delay: 30 seconds initially, increasing by 15 seconds per attempt
        const delay = 30000 + attempt * 15000;
        console.log(`Retrying after ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  
    return "Unexpected error occurred";
  }

export async function promptLLMWithConversation(params: ConverseCommandInput): Promise<string> {
    const retryCount = 3;
    const client = new BedrockRuntimeClient({ region: "us-east-1" });

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        const response = await client.send(
          new ConverseCommand(params),
        );
  
        console.log("\n\n\n\n\n\n\n\n\n\n\n")
        console.log("RESPONSE OUTPUT MESSAGE:")
        console.log(JSON.stringify(response!.output!.message, null, 2))
        console.log("\n\n\n\n\n\n\n\n\n\n\n")
   
  
        let responseText;
  
        if (response?.output?.message?.content?.[0]?.text) {
          responseText = response.output.message.content[0].text;
        }
  
        if (responseText) {
          return responseText;
        } else {
          return "No response from LLM/Error getting LLM response";
        }
      } catch (error) {
        console.error(`Error getting LLM response (attempt ${attempt + 1}/${retryCount}):`, error);
  
        if (attempt === retryCount - 1) {
          return "Error getting LLM response after multiple attempts";
        }
  
        // Calculate delay: 30 seconds initially, increasing by 15 seconds per attempt
        const delay = 30000 + attempt * 15000;
        console.log(`Retrying after ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  
    return "Unexpected error occurred";
}

// Function to add a message to a specific chatID
export async function addMessageToChat(ak: string, chatID: string, author: string, messageContent: string): Promise<void> {
    try {
        // Initialize DynamoDB client
        const dynamoDbClient = new DynamoDBClient({ region: 'us-east-1' });
        const documentClient = DynamoDBDocumentClient.from(dynamoDbClient);
        // First, store the message content in S3
        const messageS3Url = await addToS3(messageContent); // This uploads the message and returns the S3 URL

        // Create a unique timestamp for the new message
        const timestamp = new Date().toISOString(); // Use ISO string for unique message ID
        const messageID = `msg${uuidv4()}`.replace(/-/g, '');

        // Construct the new message object
        const newMessage = {
            author: author,
            messageS3: messageS3Url,
        };

        await initializePathIfNeeded(documentClient, Resource.GenesissAPITable.name, { ak }, ['chats', chatID, 'messages']);

        // Update the DynamoDB item with the new message
        await documentClient.send(
            new UpdateCommand({
                TableName: 'YourDynamoDBTableName', // Replace with your actual table name
                Key: { ak },
                UpdateExpression: `
                    SET #chats.#chatID.#messages.#messageID = :newMessage
                `,
                ExpressionAttributeNames: {
                    '#chats': 'chats',
                    '#chatID': chatID,
                    '#messages': 'messages',
                    '#messageID': messageID,
                },
                ExpressionAttributeValues: {
                    ':newMessage': newMessage,
                },
                ReturnValues: 'UPDATED_NEW',
            })
        );

        console.log(`Message added to chatID: ${chatID} for user: ${ak}`);

    } catch (error) {
        console.error('Error adding message to chat:', error);
        throw new Error('Failed to add message to chat');
    }
}

export async function initializePathIfNeeded(
    client: DynamoDBDocumentClient,
    tableName: string,
    key: Record<string, any>,
    path: string[]
  ) {
    let currentPath = '';
    let expressionAttributeNames: Record<string, string> = {};
    let expressionAttributeValues: Record<string, any> = {};
  
    for (let index = 0; index < path.length; index++) {
      const segment = path[index];
      currentPath += `#${segment}`;
      expressionAttributeNames[`#${segment}`] = segment;
      expressionAttributeValues[`:emptyMap${index}`] = {};
  
      // Rebuild the full attribute name map for each level
      const currentExpressionAttributeNames = Object.assign({}, expressionAttributeNames);
      
      const updateExpression = `SET ${currentPath} = if_not_exists(${currentPath}, :emptyMap${index})`;
  
      const initCommand = new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: currentExpressionAttributeNames,
        ExpressionAttributeValues: { [`:emptyMap${index}`]: {} },
      });
  
      try {
        await client.send(initCommand);
      } catch (err) {
        console.error('Error initializing path:', err);
        throw err;
      }
  
      // Extend the path for the next iteration
      if (index < path.length - 1) {
        currentPath += '.';
      }
    }
  }

  export async function searchInternetWithQueries(queries: string[]): Promise<string>{
    // for each query, search internet, then generate an answer to the query, then append these together

    let answers = ''
    for (const query of queries) {
        const answer = await searchWebJina(query);

        const queryPrompt = `For the query: ${query}, generate an answer to the query based on the internet results: ${JSON.stringify(answer)}. Make sure to include references and other relevant information and links as needed. The answer should be in markdown format.`
        const LLMResponse = await promptLLM(queryPrompt);

        answers += `Result for query: ${query}\n\n${JSON.stringify(LLMResponse)}\n\n`
    }

    return answers
}

export interface JinaSearchResult {
    link: string;
    title: string;
    description: string;
    content?: string;
}

export interface JinaSearchParams {
code: number;
status: number;
data: Array<{
    title: string;
    description: string;
    content?: string;
    usage: {
    tokens: number;
    };
    link: string;
}>;
[key: string]: any;
}

export async function searchWebJina(query: string): Promise<JinaSearchResult[]> {
    const JINA_API_TOKEN = JINA_API_KEY; // Replace with your actual Jina API token
  
    const url = `https://s.jina.ai/https://example.com?query=${encodeURIComponent(query)}`;
  
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          "Authorization": `Bearer ${JINA_API_TOKEN}`,
          "Accept": "application/json"
        }
      });
  
      if (!response.ok) {
        throw new Error(`Error fetching data from Jina: ${response.statusText}`);
      }
  
      // Use the JinaSearchParams export interface
      const data: JinaSearchParams = await response.json();
  
      console.log(JSON.stringify(data, null, 2));
  
      // Transform the data into JinaSearchResult objects
      const results: JinaSearchResult[] = data.data.map(item => ({
        link: item.link,
        title: item.title,
        description: item.description,
        content: item.content // Optional field
      }));
  
      return results;
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }

export interface DeployCronAgentRespoonse{
    jobID: string,
    cronBrainID: string
}
export async function deployCronAgents (ak: string, agents: Agent[][], schedule: string, callbackUrl: string, state?: string, brainID?: string): Promise<DeployCronAgentRespoonse> {

    try {

        let newBrainID

        const jobID = generateUniqueID()

        brainID ? newBrainID = brainID : newBrainID = generateUniqueID()

        const AgentToolbox = {
            internetChat: (prompt: string) => internetChatAgent(prompt),
            simpleChat: (prompt: string) => simpleChatAgent(prompt),
            proChat: (prompt: string) => proChatAgent(prompt),
            smartCodeExecution: (prompt: string) => smartCodeExecutionAgent(prompt),
            imageGeneration: (prompt: string) => imageGenerationAgent(prompt),
            graphGeneration: (prompt: string) => graphGenerationAgent(prompt),
            documentGeneration: (prompt: string) => documentGenerationAgent(prompt),
            addToMemory: (prompt: string, ak:string, brainID: string) => addToMemoryAgent(prompt, ak, brainID),
            searchMemory: (prompt: string, ak:string, brainID: string) => searchMemoryAgent(prompt, ak, brainID)
        }

        // if agents includes an agent that doesn't exist in AgentToolbox, throw error. utilize a for loop

        for (const agent of agents) {
            if (!Object.keys(AgentToolbox).includes(agent[0].agent)) {
                throw new Error(`Agent ${agent[0]} does not exist in AgentToolbox.`)
            }
        }     

        // brainID is randomly generated if no brainID provided

        const internalJobsParams: InternalJobsRequest = {
            ak: Resource.InternalAPIKey.value,
            jobID: jobID,
            callbackUrl: callbackUrl,
            state: state,
            brainID: newBrainID,
            agents: agents,
        }

        // deploy cron lambda

        const apiUrl = getApiUrl('/internaljobs');
        const roleArn = Resource.RTRoleArn.value; 

        const functionCode = Buffer.from(`
            const http = require('http');
            exports.handler = async function(event) {
              const options = {
                hostname: '${new URL(apiUrl).hostname}',
                path: '${new URL(apiUrl).pathname}',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              };
      
              const data = JSON.stringify(${JSON.stringify(internalJobsParams)});
      
              const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                  responseData += chunk;
                });
                res.on('end', () => {
                  console.log('Response:', responseData);
                });
              });
      
              req.on('error', (error) => {
                console.error('Error calling orchestrator:', error);
              });
      
              req.write(data);
              req.end();
            };
          `, 'utf-8').toString('base64');

        const lambdaClient = new LambdaClient({ region: 'us-east-1' });
        const cloudWatchClient = new CloudWatchEventsClient({ region: 'us-east-1' });


        // Create the Lambda function
        const createLambdaResponse = await lambdaClient.send(new CreateFunctionCommand({
            Code: { ZipFile: Buffer.from(functionCode, 'base64') },
            FunctionName: 'GENESISSJOB_' + jobID,
            Handler: 'index.handler',
            Role: roleArn,
            Runtime: 'nodejs20.x',
          }));
        
          // Create the CloudWatch rule for the cron schedule
        const createRuleResponse = await cloudWatchClient.send(new PutRuleCommand({
            Name: `GENESISSCRON_${jobID}`,
            ScheduleExpression: schedule,
            State: 'ENABLED',
        }));

        // Attach the Lambda function to the CloudWatch rule
        await cloudWatchClient.send(new PutTargetsCommand({
            Rule: `GENESISSCRON_${jobID}`,
            Targets: [{ Id: '1', Arn: createLambdaResponse.FunctionArn! }],
          }));

        // Grant CloudWatch Events permission to invoke the Lambda function
        await lambdaClient.send(new AddPermissionCommand({
            Action: 'lambda:InvokeFunction',
            FunctionName: 'GENESISSJOB_' + jobID,
            Principal: 'events.amazonaws.com',
            SourceArn: createRuleResponse.RuleArn!,
            StatementId: `AllowExecutionFromCloudWatch`,
        }));

        const response = {
            jobID: jobID,
            cronBrainID: newBrainID
        }

        return response

    } catch (error) {
        console.error(error);
        throw error;
    }

}

// Helper function to construct the API URL

export function getApiUrl(route: string): string {
  const baseUrl = 'http://genesiss.tech';
  return `${baseUrl}${route}`;
}


// ░█████╗░░██████╗░███████╗███╗░░██╗████████╗░██████╗
// ██╔══██╗██╔════╝░██╔════╝████╗░██║╚══██╔══╝██╔════╝
// ███████║██║░░██╗░█████╗░░██╔██╗██║░░░██║░░░╚█████╗░
// ██╔══██║██║░░╚██╗██╔══╝░░██║╚████║░░░██║░░░░╚═══██╗
// ██║░░██║╚██████╔╝███████╗██║░╚███║░░░██║░░░██████╔╝
// ╚═╝░░╚═╝░╚═════╝░╚══════╝╚═╝░░╚══╝░░░╚═╝░░░╚═════╝░

export async function internetChatAgent(prompt: string): Promise<string>{
    let searchqueries = [];

    const oldllmPrompt = prompt;
    let llmPrompt = 
`BEGIN SYSTEM PROMPT: For the following prompt, generate a list of internet queries that would aid in answering the prompt. Construct good, specific questions because you aren't allowed to answer without citing sources. The current date is ${ new Date().toDatestring }. Your response should be formatted like the following JSON (but make sure your JSON is stringified):
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

    return finalLLMAnswer


}

export async function simpleChatAgent(prompt: string): Promise<string>{
    let llmPrompt = "You are an AI agent with no specific identity. If you are asked to take or use a persona, you can. Otherwise, do not identify yourself.\n\nYou have been given the following prompt:\n\n"+prompt+"\n\nGenerate an answer to the prompt.";
    return promptLLM(llmPrompt)
}

export async function proChatAgent(prompt: string): Promise<string>{
    let searchqueries = [];

    const oldllmPrompt = prompt;
    let llmPrompt = 
`BEGIN SYSTEM PROMPT: For the following prompt, generate a list of internet queries that would aid in answering the prompt. Construct good, specific questions because you aren't allowed to answer without citing sources. The current date is ${ new Date().toDatestring }. Your response should be formatted like the following JSON (but make sure your JSON is stringified):
    {
        "queries": [
            "query 1",
            "query 2",
            "query 3", // etc, as needed.
        ]
    }
END SYSTEM PROMPT

Prompt:
${oldllmPrompt}
`
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

    const secondResponsePrompt =  "For the following prompt, you have the following Internet Context: All answers you provide must be backed with sources" + internetContext + "\n\n" + oldllmPrompt + "\n\n" + "HOWEVER, if you need more searches to obtain more information to answer the question, the output a STRINGIFIED JSON that looks like following (also note that queries are allowed to be links). All answers you provide must be backed with sources. If you are not generating queries, then your response should be in normal text. Only include this JSON as your response, including ANY extra letters or words willr esult in the failed parsing of the JSON:" + `{
        "queries": [
            "query 1",
            "query 2",
            "query 3", // etc, as needed.
        ],
        "SYSgenesissMore": "true"
    }`;

    if(secondResponsePrompt.includes("SYSgenesissMore")){
        try {
            const responseParsedJSON = JSON.parse(secondResponsePrompt);
            searchqueries = responseParsedJSON.queries;
            internetContext = await searchInternetWithQueries(searchqueries);
        } catch (error) {
            console.error("Failed to parse JSON:", error);
            const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + secondResponsePrompt);
            try {
                const responseParsedJSON = JSON.parse(fixedJSON);
                searchqueries = responseParsedJSON.queries;
                internetContext = await searchInternetWithQueries(searchqueries);
            } catch (error) {
                console.error("Failed to fix and parse JSON:", error);
            }
        }
    }

    const finalResponsePrompt =  "For the following prompt, you have the following Internet Context: All your claims/answers must be backed by sources" + internetContext + "\n\n" + oldllmPrompt;

    const finalLLMAnswer = await promptLLM(finalResponsePrompt);

    return finalLLMAnswer
}


export interface SmartCodeExecResponse{
    ranCode: RanCode[],
    conclusion: string
}

export interface RanCode {
    code: string,
    stdout: string
}

export interface SubmissionPayload {
    source_code: string;
    language_id: number;
    stdin?: string;
}

export interface SubmissionResponse {
    token: string;
}

export interface SubmissionResult {
    stdout: string | null;
    stderr: string | null;
    compile_output: string | null;
    message: string | null;
    status: {
        id: number;
        description: string;
    };
    time: string;
    memory: number;
}

const apiUrl = 'https://judge0-ce.p.rapidapi.com/submissions';
const apiKey = Resource.Judge0APIKey.value;

export async function createSubmission(source_code: string, language_id: number, stdin: string = ''): Promise<string | null> {
    const payload: SubmissionPayload = {
        source_code,
        language_id,
        stdin,
    };

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'judge0-ce.p.rapidapi.com',
        },
        body: JSON.stringify(payload),
    };

    try {
        const response = await fetch(`${apiUrl}?base64_encoded=false&wait=true`, options);
        const data = await response.json() as SubmissionResponse;
        return data.token;
    } catch (error) {
        console.error('Error creating submission:', error);
        return null;
    }
}

export async function getSubmissionResult(token: string): Promise<SubmissionResult | null> {
    const options = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'judge0-ce.p.rapidapi.com',
        },
    };

    try {
        const response = await fetch(`${apiUrl}/${token}?base64_encoded=false&fields=*`, options);
        const data = await response.json() as SubmissionResult;
        return data;
    } catch (error) {
        console.error('Error fetching submission result:', error);
        return null;
    }
}

export async function apiRunCode(code: string, languageId: number): Promise<SubmissionResult | null> {
    const token = await createSubmission(code, languageId);

    const delayInMilliseconds = 100000; //1 second

    if (token) {
        setTimeout(async function() {
            //your code to be executed after 1 second
            const result = await getSubmissionResult(token);
            return result;
        }, delayInMilliseconds);
    }
    return null;
}

export async function smartCodeExecutionAgent(prompt: string): Promise<SmartCodeExecResponse>{
    
    // generate steps to solving the prompt

    const res1CA = await promptLLM(
        `You are a code agent in a swarm of agents that make up a large AI system/brain called LEVLEX.
        Your job is to receive code instructions, and then run code.
        You have received the following instructions:
        ${prompt}

        
        Firse, before any code is generated, generate a tasklist to achieve the goal which answers the prompt, format your response as follows:

        
        {
            "tasks": [
            "task 1",
            "task 2",
            "task 3",   
            "etc."
            ]
        }
        

        You are not allowed to include anything else other than the stringified JSON, because your response will be parsed, and any extra characters or words will cause the parsing to fail`
    );

    let taskList

    try {
        taskList = JSON.parse(res1CA)
    } catch (error) {
        const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + res1CA);
        try {
            taskList = JSON.parse(fixedJSON);
        } catch (error) {
            console.error("Failed to fix and parse JSON:", error);
        }
    }
     
    let tasks: string[] = [];

    let currentTaskIndex = 0;

    const codeStore: Array<{ codeRun: string, codeResult: SubmissionResult | null }> = [];
    const runCodeStore: RanCode[] = []

    while (currentTaskIndex < tasks.length) {
        const task = tasks[currentTaskIndex];

        const taskCodeResponse = await promptLLM(`You are a code agent in a swarm of agents that make up a large AI system/brain called LEVLEX.
            Your job is to receive code instructions, and then either generate and run code.
    
            The current task is: 
            ${task}.
    
            Write code to accomplish the task. You have access to the following languages: 
            ${languages.map(l => l.name).join(', ')}.
    
            Note that the code you write will be run in a secure environment, so you can't access the internet or any external resources.
            However, you only have the standard library for all the languages.
            You should likely use Python for most tasks, unless the instructions specify otherwise or another language is a better fit for the task.
    
            Your response should be formatted as follows. It's imperative you only include the following stringified JSON response, and nothing else, or else your response wil fail to eb parsed:
            
            {
                "name": "the language of the file",
                "code": "code, formatted as a string, with newlines and all, as relevant. Make sure to escape any quotes in the code. Make sure that your code between the RESPONSE_BEGIN and RESPONSE_END is properly formatted JSON so it can be extracted."
            }
            `);

        let taskCodeJSON

        try {
            taskCodeJSON = JSON.parse(res1CA)
        } catch (error) {
            const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + taskCodeResponse, 'sonnet');
            try {
                taskCodeJSON = JSON.parse(fixedJSON);
            } catch (error) {
                console.error("Failed to fix and parse JSON:", error);
            }
        }

        let codethatwasrun = '';

        try {
            if (taskCodeJSON && 'name' in taskCodeJSON && 'code' in taskCodeJSON && typeof taskCodeJSON.code === 'string') {
                codethatwasrun = taskCodeJSON.code;
            }
        } catch (error) {
            console.error("Error extracting task code:", error);
            throw new Error("Error extracting task code");
        }

        const taskCodeContent = taskCodeJSON.code;
        const languageId = languages.find(l => l.name === taskCodeJSON.language)?.id;

        if (!languageId) {
            throw new Error("Language ID not found for the given language");
        }

        const taskResult = await apiRunCode(taskCodeContent, languageId);

        const stdout = taskResult!.stdout ? taskResult!.stdout : taskResult!.stderr

        runCodeStore.push({
            code: codethatwasrun,
            stdout: stdout ? stdout : ''
        })

        currentTaskIndex++;
        
    }

    const summaryPrompt = `Given the prompt: ${prompt}, and the ran code, generate a final response:\n\n${JSON.stringify(runCodeStore)}`
    const summary = await promptLLM(summaryPrompt)

    const finalResponse: SmartCodeExecResponse = {
        ranCode: runCodeStore,
        conclusion: summary
    }

    return finalResponse

    
}

const languages = [
    { id: 45, name: "Assembly (NASM 2.14.02)" },
    { id: 46, name: "Bash (5.0.0)" },
    { id: 47, name: "Basic (FBC 1.07.1)" },
    { id: 75, name: "C (Clang 7.0.1)" },
    { id: 76, name: "C++ (Clang 7.0.1)" },
    { id: 48, name: "C (GCC 7.4.0)" },
    { id: 52, name: "C++ (GCC 7.4.0)" },
    { id: 49, name: "C (GCC 8.3.0)" },
    { id: 53, name: "C++ (GCC 8.3.0)" },
    { id: 50, name: "C (GCC 9.2.0)" },
    { id: 54, name: "C++ (GCC 9.2.0)" },
    { id: 86, name: "Clojure (1.10.1)" },
    { id: 51, name: "C# (Mono 6.6.0.161)" },
    { id: 77, name: "COBOL (GnuCOBOL 2.2)" },
    { id: 55, name: "Common Lisp (SBCL 2.0.0)" },
    { id: 90, name: "Dart (2.19.2)" },
    { id: 56, name: "D (DMD 2.089.1)" },
    { id: 57, name: "Elixir (1.9.4)" },
    { id: 58, name: "Erlang (OTP 22.2)" },
    { id: 44, name: "Executable" },
    { id: 87, name: "F# (.NET Core SDK 3.1.202)" },
    { id: 59, name: "Fortran (GFortran 9.2.0)" },
    { id: 60, name: "Go (1.13.5)" },
    { id: 95, name: "Go (1.18.5)" },
    { id: 88, name: "Groovy (3.0.3)" },
    { id: 61, name: "Haskell (GHC 8.8.1)" },
    { id: 91, name: "Java (JDK 17.0.6)" },
    { id: 62, name: "Java (OpenJDK 13.0.1)" },
    { id: 63, name: "JavaScript (Node.js 12.14.0)" },
    { id: 93, name: "JavaScript (Node.js 18.15.0)" },
    { id: 78, name: "Kotlin (1.3.70)" },
    { id: 64, name: "Lua (5.3.5)" },
    { id: 89, name: "Multi-file program" },
    { id: 79, name: "Objective-C (Clang 7.0.1)" },
    { id: 65, name: "OCaml (4.09.0)" },
    { id: 66, name: "Octave (5.1.0)" },
    { id: 67, name: "Pascal (FPC 3.0.4)" },
    { id: 85, name: "Perl (5.28.1)" },
    { id: 68, name: "PHP (7.4.1)" },
    { id: 43, name: "Plain Text" },
    { id: 69, name: "Prolog (GNU Prolog 1.4.5)" },
    { id: 70, name: "Python (2.7.17)" },
    { id: 92, name: "Python (3.11.2)" },
    { id: 71, name: "Python (3.8.1)" },
    { id: 80, name: "R (4.0.0)" },
    { id: 72, name: "Ruby (2.7.0)" },
    { id: 73, name: "Rust (1.40.0)" },
    { id: 81, name: "Scala (2.13.2)" },
    { id: 82, name: "SQL (SQLite 3.27.2)" },
    { id: 83, name: "Swift (5.2.3)" },
    { id: 74, name: "TypeScript (3.7.4)" },
    { id: 94, name: "TypeScript (5.0.3)" },
    { id: 84, name: "Visual Basic.Net (vbnc 0.0.0.5943)" }
];

export const uploadPNGToS3 = async (imageBuffer: Buffer): Promise<string> => {
    const s3Client = new S3Client({ region: 'us-east-1' });
    const bucketName = Resource.GenesissPublicBucket.name;
    const uniqueID = generateUniqueID()
    const key = `GSC_${uniqueID}.png`;
  
    const params = {
      Bucket: bucketName,
      Key: key,
      Body: imageBuffer,
      ContentType: 'image/png',
    };
  
    await s3Client.send(new PutObjectCommand(params));
  
    return `https://${bucketName}.s3.amazonaws.com/${key}`;
  };

// Returns a URL to an image generated by the inputted prompt string
export async function imageGenerationAgent(prompt: string, width?:number, height?:number): Promise<string>{

     interface PredictionResult {
        output: string[];
        [key: string]: any; // Allow additional properties
      }

      const replicate = new Replicate({
        auth: Resource.ReplicateAPIKey.value,
      });
      
      let params

      if ( width && height ){
        params = {
            input: {
              width: width,
              height: height,
              prompt: prompt,
              refine: 'expert_ensemble_refiner',
              scheduler: 'K_EULER',
              lora_scale: 0.6,
              num_outputs: 1,
              guidance_scale: 7.5,
              apply_watermark: false,
              high_noise_frac: 0.8,
              negative_prompt: '',
              prompt_strength: 0.8,
              num_inference_steps: 25,
            },
          }
      } else {
        params = {
            input: {
              width: 768,
              height: 768,
              prompt: prompt,
              refine: 'expert_ensemble_refiner',
              scheduler: 'K_EULER',
              lora_scale: 0.6,
              num_outputs: 1,
              guidance_scale: 7.5,
              apply_watermark: false,
              high_noise_frac: 0.8,
              negative_prompt: '',
              prompt_strength: 0.8,
              num_inference_steps: 25,
            },
          }
      }
  
      const prediction = (await replicate.run(
        'black-forest-labs/flux-dev',
        params
      )) as PredictionResult;
  
      const imageUrl = prediction.output[prediction.output.length - 1];

      try {
        // Fetch the image from the URL
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image from URL: ${imageUrl}`);
        }
    
        // Read the image data as a buffer
        // Convert the response to an ArrayBuffer and then to a Buffer
        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
    
        // Upload the image buffer to S3
        const s3Link = await addToS3(imageBuffer.toString('base64'), true, true, undefined);
    
        return s3Link;
      } catch (error) {
        console.error('Error processing image:', error);
        throw new Error('Failed to generate or upload the image');
      }


}

export async function graphGenerationAgent(prompt: string, width?:number, height?:number): Promise<string>{
    const preChatParams = await promptLLM(`
        You are an intelligent assistant capable of generating configurations for data visualization using Chart.js. Your task is to generate a Chart.js configuration object based on a prompt.
        The canvas is 800x600 pixels.
        Your prompt is:
        ${prompt}
        The background must be black, so make your graphs/charts dark themed.
        Please generate the chart.js configuration object and return it as a stringified JSON object. It is important you dont' include any extra words, characters, or content because your response will be JSON parsed.
        For example:
        
        {
          "type": "bar",
          "data": {
            "labels": ["Red", "Blue", "Yellow", "Green", "Purple", "Orange"],
            "datasets": [{
              "label": '# of Votes',
              "data": [12, 19, 3, 5, 2, 3],
              "backgroundColor": 'rgba(255, 99, 132, 0.2)',
              "borderColor": 'rgba(255, 99, 132, 1)',
              "borderWidth": 1
            }]
          },
          "options": {}
        }
        
      `);

    let chartParams

    try {
        chartParams = JSON.parse(preChatParams)
    } catch (error) {
        const fixedJSON = await promptLLM("fix the stringified JSON, it failed parsing, your response will be parsed as JSON: " + preChatParams, 'sonnet');
        try {
            chartParams = JSON.parse(fixedJSON);
        } catch (error) {
            console.error("Failed to fix and parse JSON:", error);
        }
    }

    let wwidth
    let hheight

    width ? wwidth = width : wwidth = 800

    height ? hheight = height : hheight = 600

    // Create canvas and chart context
    const canvas = createCanvas(wwidth, hheight);
    const ctx = canvas.getContext("2d");

    // Render chart
    const chart = new Chart(ctx as unknown as ChartItem, chartParams);

    // Convert canvas to a buffer and upload it to S3
    const imageBuffer = await new Promise<Buffer>((resolve, reject) => {
        canvas.toBuffer((error, buffer) => {
            chart.destroy();
            if (error) {
                return reject(error);
            }
            resolve(buffer);
        }, "image/png");
    });

    // Function to handle image upload to S3
    const imageUrl = await uploadPNGToS3(imageBuffer);

    return imageUrl

}

export async function documentGenerationAgent(prompt: string): Promise<string>{
    const markdown = await promptLLM("Generate a markdown document for the following prompt: \n" + prompt)
    return generateMarkdownPDF(markdown)
}

// Function to generate a PDF from a markdown string and upload it to S3
export async function generateMarkdownPDF(markdown: string): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            // Create a new PDF document
            const doc = new PDFDocument();
            let buffers: Buffer[] = [];

            // Convert markdown to HTML
            const md = new markdownIt();
            const htmlContent = md.render(markdown);

            // Capture the PDF data in buffers
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', async () => {
                try {
                    // Combine all the buffers into a single buffer
                    const pdfData = Buffer.concat(buffers);

                    // Upload the PDF buffer to S3 using addToS3 function
                    const s3Url = await addToS3(pdfData, false, false, `${uuidv4()}.pdf`);

                    // Resolve the promise with the S3 URL
                    resolve(s3Url);
                } catch (uploadError) {
                    console.error('Error uploading PDF to S3:', uploadError);
                    reject(new Error('Failed to upload PDF to S3'));
                }
            });

            // Add the HTML content to the PDF
            doc.text(htmlContent, {
                align: 'left',
                lineGap: 4,
                paragraphGap: 10,
                indent: 20,
                continued: false,
            });

            // Finalize the PDF document
            doc.end();
        } catch (error) {
            console.error('Error generating PDF:', error);
            reject(new Error('Failed to generate PDF'));
        }
    });
}

export async function addToMemoryAgent(prompt: string, ak: string, brainID: string): Promise<string>{
   try { 
    const addToMemoryParams = {
        ak: ak,
        brainID: brainID
    }

    await addToMemory(prompt, addToMemoryParams)

    return 'success'
    } catch (error) {
        throw error
    }
}

export async function searchMemoryAgent(prompt: string, ak: string, brainID: string): Promise<string>{
    try { 
        const addToMemoryParams = {
            ak: ak,
            brainID: brainID
        }
    
        await addToMemory(prompt, addToMemoryParams)
    
        return 'success'
        } catch (error) {
            throw error
        }
}

// Notes for docs:

// /chat
export interface CompleteChatResponse {
    chatID: string;
    message: string;
}

export interface ChatRequest{
    ak: string, // api key
    message: string, // message
    internet: boolean,
    format: 'json' | 'markdown' | 'text',
    chatID?: string,
    brainID?: string[], // memory id, you can use additional brains in addition to ChatID brain,
    images?: string[], // array of base64-encoded image files
    documents?: string[], // array of base64-encoded document files
}

// memory

// add: you can add a set of memories to a set of corresponding brain IDs, or you can add a set of memories to a brainID
export interface AddMemoryResult {
    brainID: string[];
    memoryID: string[];
}

export interface MemoryParams {
    ak: string;
    brainID: string[]; // if one brainID, all the memories in content are added to the brainID, otherwise the memories in content are added to their corresponding brainIDs, same for queries
    task: 'add' | 'delete' | 'query';
    content?: string[]; // if query, these are your queries, if add, these are your memories, if get, nonexistent, if delete, nonexistent
    numResults?: number[];
    threshold?: number[];
    metadata?: Record<string, string>[];
    excludeMetadata?: Record<string, string>[];
}

export interface QueryResults {
    metadata: {
        brainID: string;
        content: string;
        [key: string]: any;
    };
    score: number;
}[]

export interface InternalJobRequestResponse {
    jobID: string,
    cronBrainID: string,
}

export interface CalledAgent {
    agent: string,
    result: string,
}

export interface CronJobRequestResponse {
    jobID: string,
    brainID: string,
    agents: CalledAgent[][],
    state?: string,
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

// Delete job

export interface DeleteJobRequest {
    ak: string,
    jobID: string,
}

export interface DeleteJobResponse {
    jobID: string,
    success: boolean,
}