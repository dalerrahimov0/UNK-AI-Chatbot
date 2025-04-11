const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const ENABLE_PINECONE = process.env.ENABLE_PINECONE === 'true';

const pineconeService = require('./pinecone');
const simpleRag = require('./simpleRag');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Cache the loaded docs context
let docsContext = {};

// Load content from docs directory and update Pinecone
const loadDocsContext = async () => {
    const docsDir = path.join(__dirname, 'docs');
    const context = {};
    
    try {
        const files = fs.readdirSync(docsDir);
        
        for (const file of files) {
            if (file.endsWith('.md')) {
                console.log(`Loading ${file} for context`);
                const filePath = path.join(docsDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                context[file] = content;
            }
        }

        if (ENABLE_PINECONE) {
            try {
                // Upsert documents to Pinecone
                await pineconeService.upsertDocuments(context);
            } catch (error) {
                console.error('Error upserting to Pinecone:', error);
                console.error('Will continue with local context only');
            }
        }
        
        return context;
    } catch (error) {
        console.error('Error loading docs:', error);
        return {};
    }
};

// Function to handle bot responses
const askQuestion = async (topic, question, options = {}) => {
    if (!topic || !question) {
        throw new Error('Topic and question are required');
    }
    
    const { usePinecone = false } = options;
    
    try {
        // Create a context string with only relevant documents
        let contextString = `The topic is: ${topic}. Please answer the following question based on this topic.`;
        
        let relevantDocs = [];
        
        if (ENABLE_PINECONE && usePinecone) {
            try {
                // Retrieve relevant documents using Pinecone
                relevantDocs = await pineconeService.retrieveRelevantDocs(question, topic);
                console.log('Retrieved documents from Pinecone');
            } catch (error) {
                console.error('Error using Pinecone, falling back to TF-IDF:', error);
                relevantDocs = simpleRag.findSimilarDocs(question, topic, docsContext);
                console.log('Retrieved documents using TF-IDF fallback');
            }
        } else {
            console.log('Pinecone disabled for this request, using TF-IDF instead');
            relevantDocs = simpleRag.findSimilarDocs(question, topic, docsContext);
        }
        
        console.log(relevantDocs.map(d => console.log(`Relevant document: ${d.filename}, similarity: ${d.similarity.toFixed(4)}`)).join('\n'));

        const minSimilarity = usePinecone ? 0.4 : 0.1;

        if (relevantDocs.length > 0) {
            contextString += "\n\nHere is relevant reference information:\n\n";
            
            for (const { filename, content, similarity } of relevantDocs) {
                // Use a threshold for similarity
                if (similarity > minSimilarity) { // Similarity threshold
                    console.log(`Applying ${filename} to context, similarity: ${similarity.toFixed(4)}`);
                    contextString += `Document: ${filename}\n${content}\n\n`;
                } else {
                    console.log(`Skipping ${filename}, not similar enough, similarity: ${similarity.toFixed(4)}`);
                }
            }
        }

        // add sane check for context length, do not want to use all tokens
        
        // Call OpenAI API with reduced context
        const completion = await openai.chat.completions.create({
            model: "gpt-4", // or any other model you prefer
            messages: [
                { role: "system", content: "You are a helpful assistant providing accurate information on various topics. When possible, use the reference information provided to answer questions accurately. Format your responses using Markdown syntax for better readability. Use headings (##), bullet points (*), numbered lists (1.), code blocks (```), emphasis (**bold**, *italic*), and other markdown formatting where appropriate." },
                { role: "user", content: `${contextString}\n\nQuestion: ${question}` }
            ],
            max_tokens: 500
        });

        console.log(`Tokens: prompt=${completion.usage.prompt_tokens}, completion=${completion.usage.completion_tokens}, total=${completion.usage.total_tokens}`);
        
        // Extract the answer from the response
        const rawAnswer = completion.choices[0].message.content;
        
        // Return the answer along with token usage information
        return {
            answer: rawAnswer,
            usage: {
                promptTokens: completion.usage.prompt_tokens,
                completionTokens: completion.usage.completion_tokens,
                totalTokens: completion.usage.total_tokens
            }
        };
    } catch (error) {
        console.error('Error in askQuestion:', error);
        throw error;
    }
};

// Initialize when the module is loaded
(async () => {
    try {
        // Load initial docs
        docsContext = await loadDocsContext();
        console.log('Documents loaded successfully');
    } catch (error) {
        console.error('Failed to initialize bot:', error);
    }
})();

module.exports = {
    loadDocsContext,
    askQuestion,
    clearPineconeIndex: pineconeService.clearPineconeIndex,
    initPinecone: pineconeService.initPinecone
};
