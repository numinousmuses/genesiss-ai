/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import Cors from 'cors';
import { 
  verifyApiKey,  
  generateUniqueID, 
  addToMemory,
  searchMemoryAdvanced,
  deleteMemory
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
    
    if (req.method === 'POST'){
        try {
            
            let { ak, brainID, task, content, numResults, threshold, metadata, excludeMetadata }= await req.json();

            if (!ak || !brainID || !task) {
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
    
            switch(task){
                case 'add':
    
                    interface AddMemoryResult {
                        brainID: string[];
                        memoryID: string[];
                    }
    
                    if (!ak || !brainID || !content) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ error: 'Missing required parameters' }),
                        };
                    }
    
                    let memoryIDs: string[] = []
                    
    
                    if (brainID.length > 1) {
    
                        if (brainID.length != content.length) {
                            return {
                                statusCode: 400,
                                body: JSON.stringify({ error: 'brainID and content must have the same length, or only one brainID is allowed' }),
                            };
                        }
    
                        let index = 0
    
                        for (let brainIDs of brainID) {
    
                            let memory = content[index]
                            const memoryID = generateUniqueID();
                            memoryIDs.push(memoryID);
    
                            let parammetadata
    
                            parammetadata = {
                                brainID: brainIDs,
                                memoryID: memoryID,
                            };
    
                            if (metadata[index]) {
                                parammetadata = {
                                    brainID: brainIDs,
                                    memoryID: memoryID,
                                    ...metadata[index],
                                };
                            }
    
                            await addToMemory(memory, parammetadata)
    
                            index++
                        }
    
                        let finalResponse = {
                            brainID: brainID,
                            memoryID: memoryIDs,
                        }
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify(finalResponse),
                        };
    
                    } else if (brainID.length == 1) {
                        
                        let memoryIDs: string[] = []
    
                        let index = 0
    
                        for (let memory of content) {
                            const memoryID = generateUniqueID();
                            memoryIDs.push(memoryID);
    
                            let parammetadata
    
                            parammetadata = {
                                brainID: brainID[0],
                                memoryID: memoryID,
                            };
    
                            if (metadata[index]) {
                                parammetadata = {
                                    brainID: brainID[0],
                                    memoryID: memoryID,
                                    ...metadata[index],
                                };
                            }
    
                            await addToMemory(memory, parammetadata)
    
                            index++
                        }
    
                        let finalResponse = {
                            brainID: brainID,
                            memoryID: memoryIDs,
                        }
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify(finalResponse),
                        };
    
                    } else {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ error: 'brainID must have a length of 1 or more' }),
                        }
                    }
     
                     interface MemoryParams {
                        ak: string;
                        brainID: string[]; // if one brainID, all the memories in content are added to the brainID, otherwise the memories in content are added to their corresponding brainIDs, same for queries
                        task: 'add' | 'delete' | 'query';
                        content?: string[]; // if query, these are your queries, if add, these are your memories, if get, nonexistent, if delete, nonexistent
                        numResults?: number[]; // Defaults to 10
                        threshold?: number[]; // Defaults to 0.5
                        metadata?: Record<string, string>[];
                        excludeMetadata?: Record<string, string>[];
                    }
    
                case 'query':
                    if (!ak || !brainID || !content) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ error: 'Missing required parameters' }),
                        };
                    }
    
                     interface QueryMemoryResult {
                        brainID: string[];
                        results: QueryResult[];
                    }
    
                     interface QueryResult {
                        metadata: {
                            brainID: string;
                            content: string;
                            [key: string]: any;
                        };
                        score: number;
                    }
    
                    if (brainID.length > 1) {
    
                        if (brainID.length != content.length) {
                            return {
                                statusCode: 400,
                                body: JSON.stringify({ error: 'brainID and content must have the same length, or only one brainID is allowed' }),
                            };
                        }
    
                        let iterator = 0
                        
                        
                        let results: QueryResult[][] =[]
                        let tempres: QueryResult[]
                        
                        for (let brainIDs of brainID) {
                            let query = content[iterator]
    
                            let queryMetadata = {
                                brainID: brainIDs,
                                ak: ak,
                            }
    
                            if (metadata[iterator]) {
                                queryMetadata = {
                                    brainID: brainIDs,
                                    ak: ak,
                                    ...metadata[iterator],
                                };
                            }
    
                            
    
                            if (!excludeMetadata[iterator]) {
                                
    
                                if(numResults[iterator] && threshold[iterator]) {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, undefined, { count: numResults[iterator], threshold: threshold[iterator] })
                                    results.push(tempres)
                                } else if (numResults[iterator]) {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, undefined, { count: numResults[iterator] })
                                    results.push(tempres)
                                } else if (threshold[iterator]) {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, undefined, { threshold: threshold[iterator] })
                                    results.push(tempres)
                                } else {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata)
                                    results.push(tempres)
                                }
    
                                
    
                            } else if (excludeMetadata[iterator]) {
        
                                if(numResults[iterator] && threshold[iterator]) {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, excludeMetadata[iterator], { count: numResults[iterator], threshold: threshold[iterator] })
                                    results.push(tempres)
                                } else if (numResults[iterator]) {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, excludeMetadata[iterator], { count: numResults[iterator] })
                                    results.push(tempres)
                                } else if (threshold[iterator]) {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, excludeMetadata[iterator], { threshold: threshold[iterator] })
                                    results.push(tempres)
                                } else {
                                    tempres = await searchMemoryAdvanced(query, queryMetadata, excludeMetadata[iterator])
                                    results.push(tempres)
                                }
    
                            }
    
                            iterator++
                        }
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify(results),
                        };
    
                    } else if (brainID.length == 1) {
                        let iterator = 0
    
                        let results: QueryResult[][] = []
                        let tempRes: QueryResult[]
    
                        for (let query of content) {
                            let queryMetadata = {
                                brainID: brainID[0],
                                ak: ak,
                            }
    
                            if (metadata[iterator]) {
                                queryMetadata = {
                                    brainID: brainID[0],
                                    ak: ak,
                                    ...metadata[iterator],
                                };
                            }
    
                            if (!excludeMetadata[iterator]) {
                                if (numResults[iterator] && threshold[iterator]) {
                                    tempRes = await searchMemoryAdvanced(query, queryMetadata)
                                    results.push(tempRes)
                                } else if (numResults[iterator]) {
                                    tempRes = await searchMemoryAdvanced(query, queryMetadata, undefined, { count: numResults[iterator] })
                                    results.push(tempRes)
                                } else if (threshold[iterator]) {
                                    tempRes = await searchMemoryAdvanced(query, queryMetadata, undefined, { threshold: threshold[iterator] })
                                    results.push(tempRes)  
                                } else {
                                    tempRes = await searchMemoryAdvanced(query, queryMetadata)
                                    results.push(tempRes)
                                }
                            } else if (excludeMetadata[iterator]) {
                                tempRes = await searchMemoryAdvanced(query, queryMetadata, excludeMetadata[iterator])
                                results.push(tempRes)
                            }
    
                            iterator++
                        }
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify(results),
                        };
    
                    } else {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ error: 'brainID must have a length of 1 or more' }),
                        }
                    }
                
                case "delete":
                    if (!brainID || !ak || !metadata) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ error: 'Missing required parameters' }),
                        }
                    }
    
                    if (brainID.length >1){
                        let iterator = 0
    
                        for (let brainIDs of brainID) {
                            await deleteMemory(brainIDs, ak, metadata[iterator])
                            iterator++
                        }
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify({ message: 'Memory deleted successfully' }),
                        }
                    } else if (brainID.length == 1) {
                        for (let met of metadata) {
                            await deleteMemory(brainID[0], ak, met)
                        }
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify({ message: 'Memory deleted successfully' }),
                        }
                    }
    
            }
        } catch (error) {
            console.error('Memory API Route Error:', error);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    } else {
        return NextResponse.json({ error: `Method ${req.method} Not Allowed` }, { status: 405 });
    }
}