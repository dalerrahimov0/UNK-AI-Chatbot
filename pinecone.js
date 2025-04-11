const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAI } = require('openai');

const ENABLE_PINECONE = process.env.ENABLE_PINECONE === 'true';

// Initialize OpenAI client for embeddings
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize Pinecone client for local development
const pinecone = new Pinecone({
    apiKey: "pclocal", // Default Pinecone Local API key
    controllerHostUrl: "http://localhost:5080" // Pinecone Local controller URL
});

// Pinecone index configuration
const INDEX_NAME = 'chatbot-docs';
let pineconeIndex;

// Initialize the Pinecone index
const initPinecone = async () => {
    try {
        console.log('Setting up Pinecone connection...');
        
        // Check if index exists by listing all indexes
        const {indexes} = await pinecone.listIndexes();
        const indexExists = indexes.some(index => index.name === INDEX_NAME);
        
        if (indexExists) {
            console.log(`Found existing Pinecone index: ${INDEX_NAME}`);
            // Get the host for the existing index
            const indexInfo = await pinecone.describeIndex(INDEX_NAME);
            const indexHost = indexInfo.host;
            
            // Connect to the index with full host URL
            pineconeIndex = await pinecone.index(INDEX_NAME, 'http://' + indexHost);
            
            // Check status
            const stats = await pineconeIndex.describeIndexStats();
            console.log(`Current vector count: ${stats.totalVectorCount || 0}`);
        } else {
            console.log(`Creating new Pinecone index: ${INDEX_NAME}`);
            
            // Create a dense vector index
            const indexModel = await pinecone.createIndex({
                name: INDEX_NAME,
                dimension: 1536, // OpenAI embedding dimension
                metric: 'cosine',
                vectorType: 'dense',
                spec: {
                    serverless: {
                        cloud: 'aws',
                        region: 'us-east-1'
                    }
                },
                deletionProtection: 'disabled',
                tags: { environment: 'development' }
            });
            
            console.log(`Index ${INDEX_NAME} created successfully`);
            console.log('Waiting for index to be ready...');
            
            // Wait for index to initialize
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Get the host for the new index
            const indexInfo = await pinecone.describeIndex(INDEX_NAME);
            const indexHost = indexInfo.host;
            
            // Connect to the index with full host URL
            pineconeIndex = await pinecone.index(INDEX_NAME, 'http://' + indexHost);
        }
        
        console.log('Pinecone index setup completed');
    } catch (error) {
        console.error('Error initializing Pinecone:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        throw error;
    }
};

// Generate OpenAI embeddings
const generateEmbedding = async (text) => {
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
};

// Upsert documents to Pinecone
const upsertDocuments = async (documents) => {
    try {
        // Ensure Pinecone is initialized
        if (!pineconeIndex) {
            await initPinecone();
        }
        
        const upsertBatch = [];
        
        for (const [file, content] of Object.entries(documents)) {
            console.log(`Generating embedding for ${file}`);
            // Generate embedding for the document
            const embedding = await generateEmbedding(content);
            
            // Prepare document for Pinecone upsertion
            upsertBatch.push({
                id: file,
                values: embedding,
                metadata: {
                    filename: file,
                    content: content
                }
            });
        }
        
        // Batch upsert documents to Pinecone
        if (upsertBatch.length > 0) {
            console.log(`Upserting ${upsertBatch.length} documents to Pinecone`);
            try {
                // Use namespace for better organization
                const namespace = pineconeIndex.namespace('example-namespace');
                await namespace.upsert(upsertBatch);
                console.log('Documents successfully upserted to Pinecone');
            } catch (upsertError) {
                console.error('Error upserting to Pinecone:', upsertError);
                console.error('Will continue with local context only');
                throw upsertError;
            }
        }
    } catch (error) {
        console.error('Error upserting documents:', error);
        throw error;
    }
};

// Retrieve relevant documents based on query using Pinecone
const retrieveRelevantDocs = async (query, topic, topK = 2) => {
    try {
        // Ensure Pinecone is initialized
        if (!pineconeIndex) {
            await initPinecone();
        }
        
        // Combine query and topic for better matching
        const queryText = `${topic} ${query}`;
        
        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(queryText);
        
        // Access namespace for better organization
        const namespace = pineconeIndex.namespace('example-namespace');
        
        // Query Pinecone for similar documents using latest API
        const queryResults = await namespace.query({
            vector: queryEmbedding,
            topK: topK,
            includeValues: false,
            includeMetadata: true
        });
        
        console.log(`Found ${queryResults.matches.length} relevant documents from Pinecone`);
        
        // Format results
        return queryResults.matches.map(match => ({
            filename: match.metadata.filename,
            content: match.metadata.content,
            similarity: match.score
        }));
    } catch (error) {
        console.error('Error retrieving relevant docs:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        // Rethrow the error for the caller to handle
        throw error;
    }
};

// Utility function to clear Pinecone documents
const clearPineconeIndex = async () => {
    try {
        if (!pineconeIndex) {
            await initPinecone();
        }
        
        console.log('Deleting all vectors from Pinecone index');
        // Use namespace for better organization
        const namespace = pineconeIndex.namespace('example-namespace');
        await namespace.deleteAll();
        console.log('Successfully cleared Pinecone namespace');
        return true;
    } catch (error) {
        console.error('Error clearing Pinecone namespace:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        return false;
    }
};

// Initialize Pinecone when the module is loaded
(async () => {
    if (!ENABLE_PINECONE) {
        console.log('Pinecone initialized skipped since ENABLE_PINECONE is set to false');
        return;
    }
    try {
        await initPinecone();
        console.log('Pinecone initialized');
    } catch (error) {
        console.error('Failed to initialize Pinecone:', error);
    }
})();

module.exports = {
    initPinecone,
    generateEmbedding,
    upsertDocuments,
    retrieveRelevantDocs,
    clearPineconeIndex
};
