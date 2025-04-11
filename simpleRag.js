// Simple RAG (Retrieval Augmented Generation) implementation using TF-IDF
// This is used as a fallback when Pinecone vector database is disabled or unavailable

// TF-IDF implementation for better text representation
const computeTFIDF = (documents) => {
    // Step 1: Create vocabulary and document frequency
    const vocabulary = new Set();
    const docFreq = {};
    const processedDocs = [];
    
    // Process each document
    for (const doc of documents) {
        // Tokenize and clean text
        const words = doc.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 2); // Filter out very short words
        
        // Add to vocabulary and count document frequency
        const uniqueWords = new Set(words);
        uniqueWords.forEach(word => {
            vocabulary.add(word);
            docFreq[word] = (docFreq[word] || 0) + 1;
        });
        
        processedDocs.push(words);
    }
    
    const vocabArray = Array.from(vocabulary);
    const numDocs = documents.length;
    
    // Step 2: Compute TF-IDF for each document
    return processedDocs.map(words => {
        const tfidf = {};
        const wordCounts = {};
        
        // Count word frequencies in document
        for (const word of words) {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
        
        // Compute TF-IDF for each word
        for (const word of vocabArray) {
            if (wordCounts[word]) {
                // TF = word frequency in document
                const tf = wordCounts[word] / words.length;
                // IDF = log(total docs / docs containing word)
                const idf = Math.log(numDocs / (docFreq[word] || 1));
                tfidf[word] = tf * idf;
            } else {
                tfidf[word] = 0;
            }
        }
        
        return tfidf;
    });
};

// Create local embeddings using TF-IDF
const createEmbedding = (text, allDocuments = null) => {
    // Simple implementation without caching
    
    // If we have all documents, use TF-IDF
    if (allDocuments) {
        const documents = [...allDocuments, text];
        const tfidfVectors = computeTFIDF(documents);
        return tfidfVectors[tfidfVectors.length - 1]; // Get embedding for the query
    }
    
    // Fallback to bag of words for single document processing
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(word => word.length > 2);
    const embedding = {};
    
    words.forEach(word => {
        embedding[word] = (embedding[word] || 0) + 1;
    });
    
    return embedding;
};

// Calculate cosine similarity between TF-IDF vectors
const calculateSimilarity = (queryEmbedding, docEmbedding) => {
    // If using the new TF-IDF embeddings
    if (typeof queryEmbedding === 'object' && !Array.isArray(queryEmbedding)) {
        let dotProduct = 0;
        let queryMagnitude = 0;
        let docMagnitude = 0;
        
        // Calculate dot product
        for (const word in queryEmbedding) {
            if (docEmbedding[word]) {
                dotProduct += queryEmbedding[word] * docEmbedding[word];
            }
            queryMagnitude += Math.pow(queryEmbedding[word], 2);
        }
        
        for (const word in docEmbedding) {
            docMagnitude += Math.pow(docEmbedding[word], 2);
        }
        
        queryMagnitude = Math.sqrt(queryMagnitude);
        docMagnitude = Math.sqrt(docMagnitude);
        
        if (queryMagnitude === 0 || docMagnitude === 0) return 0;
        return dotProduct / (queryMagnitude * docMagnitude);
    }
    
    // Fallback for old bag-of-words array embeddings
    const overlap = queryEmbedding.filter(word => docEmbedding.includes(word)).length;
    if (queryEmbedding.length === 0 || docEmbedding.length === 0) return 0;
    return overlap / Math.sqrt(queryEmbedding.length * docEmbedding.length);
};

// Find similar documents using TF-IDF when Pinecone is disabled
const findSimilarDocs = (query, topic, docsContext, topK = 2) => {
    try {
        // Combine query and topic for better matching
        const queryText = `${topic} ${query}`;
        
        // Get all document contents
        const allDocContents = Object.values(docsContext);
        
        // Create query embedding with TF-IDF
        const queryEmbeddingTFIDF = createEmbedding(queryText, allDocContents);
        
        // Calculate similarity for each document using TF-IDF
        const similarities = Object.entries(docsContext).map(([filename, content]) => {
            const docEmbedding = createEmbedding(content, allDocContents);
            const similarity = calculateSimilarity(queryEmbeddingTFIDF, docEmbedding);
            return { filename, content, similarity };
        });
        
        // Sort by similarity (descending) and take top K
        return similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    } catch (error) {
        console.error('Error finding similar docs with TF-IDF:', error);
        return [];
    }
};

module.exports = {
    computeTFIDF,
    createEmbedding,
    calculateSimilarity,
    findSimilarDocs
};