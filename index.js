const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const fs = require('fs');

const ENABLE_PINECONE = process.env.ENABLE_PINECONE === 'true';
console.log(`Pinecone enabled: ${ENABLE_PINECONE}`);
if (!ENABLE_PINECONE) {
    console.log('\n********\nPinecone requires the docker instance to be running.  \nIt should be able to be started with the command\n `docker-compose up -d`');
    console.log('********\n');
}

// Load environment variables from .env file
dotenv.config();

// Import bot functions after loading environment variables
const { askQuestion, clearPineconeIndex } = require('./bot');
const { fetchContentAndSaveToMarkdown } = require('./fetch_content');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Setup WebSocket server
const wss = new WebSocket.Server({ server });

// Groups to manage multiple chat sessions
const groups = new Map();

// WebSocket connection handler
wss.on('connection', (ws) => {
    let userGroup = null;

    console.log('Client connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Handle joining a group
            if (data.type === 'join') {
                userGroup = data.group;
                
                // Create group if it doesn't exist
                if (!groups.has(userGroup)) {
                    groups.set(userGroup, new Set());
                }
                
                // Add this client to the group
                groups.get(userGroup).add(ws);
                
                console.log(`Client joined group: ${userGroup}`);
                ws.send(JSON.stringify({
                    type: 'system',
                    message: `You've joined the ${userGroup} group`
                }));
                return;
            }

            // Handle group message broadcast
            if (data.type === 'broadcast') {
                if (!userGroup) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'You must join a group first'
                    }));
                    return;
                }
                
                const { username, message: msg } = data;
                
                if (!username || !msg) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Username and message are required'
                    }));
                    return;
                }
                
                // Broadcast the message to all clients in the group
                if (groups.has(userGroup)) {
                    const clients = groups.get(userGroup);
                    const response = JSON.stringify({
                        type: 'broadcast',
                        username,
                        message: msg,
                        timestamp: new Date().toISOString()
                    });
                    
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(response);
                        }
                    });
                }
            }

            // Handle questions
            if (data.type === 'question') {
                if (!userGroup) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'You must join a group first'
                    }));
                    return;
                }
                
                const { topic, question, usePinecone = false } = data;
                
                if (!topic || !question) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Topic and question are required'
                    }));
                    return;
                }
                
                // Send a "thinking" status to the client
                ws.send(JSON.stringify({
                    type: 'status',
                    message: 'Thinking...'
                }));
                
                // Use the askQuestion function from bot.js with pinecone option
                const result = await askQuestion(topic, question, { usePinecone });
                
                // Broadcast the answer to all clients in the group
                if (groups.has(userGroup)) {
                    const clients = groups.get(userGroup);
                    const response = JSON.stringify({
                        type: 'answer',
                        topic,
                        question,
                        answer: result.answer,
                        usage: result.usage
                    });
                    
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(response);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('WebSocket error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process your request'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        
        // Remove client from their group
        if (userGroup && groups.has(userGroup)) {
            groups.get(userGroup).delete(ws);
            
            // Clean up empty groups
            if (groups.get(userGroup).size === 0) {
                groups.delete(userGroup);
                console.log(`Group ${userGroup} deleted (empty)`);
            }
        }
    });
});

// Route to handle question asking (REST API)
app.post('/api/ask', async (req, res) => {
    try {
        const { topic, question, usePinecone = false } = req.body;

        if (!topic || !question) {
            return res.status(400).json({ error: 'Topic and question are required' });
        }

        const result = await askQuestion(topic, question, { usePinecone });

        res.json({
            topic,
            question,
            answer: result.answer,
            usage: result.usage
        });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Failed to process your request' });
    }
});

// Simple health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

// Endpoint to clear the Pinecone index
app.post('/api/clear-cache', async (req, res) => {
    if (!ENABLE_PINECONE) {
        res.status(500).json({ error: 'Pinecone is currently disabled' });
        return;
    }
    try {
        const success = await clearPineconeIndex();
        res.json({ 
            success, 
            message: success ? 'Pinecone index cleared successfully' : 'Failed to clear Pinecone index' 
        });
    } catch (error) {
        console.error('Error clearing Pinecone index:', error);
        res.status(500).json({ error: 'Failed to clear Pinecone index' });
    }
});

// Endpoint to list all markdown files in the docs directory
app.get('/api/docs', (req, res) => {
    try {
        const docsDir = path.join(__dirname, 'docs');

        if (!fs.existsSync(docsDir)) {
            return res.json({ files: [] });
        }

        const files = fs.readdirSync(docsDir)
            .filter(file => file.endsWith('.md'))
            .map(file => {
                const filePath = path.join(docsDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    path: `/api/docs/${file}`,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            });

        res.json({ files });
    } catch (error) {
        console.error('Error listing markdown files:', error);
        res.status(500).json({ error: 'Failed to list markdown files' });
    }
});

// Endpoint to get a specific markdown file
app.get('/api/docs/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(__dirname, 'docs', filename);

        if (!fs.existsSync(filePath) || !filename.endsWith('.md')) {
            return res.status(404).json({ error: 'File not found' });
        }

        const content = fs.readFileSync(filePath, 'utf8');

        res.set('Content-Type', 'text/markdown');
        res.send(content);
    } catch (error) {
        console.error('Error reading markdown file:', error);
        res.status(500).json({ error: 'Failed to read markdown file' });
    }
});

// Endpoint to process multiple URLs and save as markdown
app.post('/api/fetch', async (req, res) => {
    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ 
                error: 'Please provide an array of URLs to process' 
            });
        }

        const results = await fetchContentAndSaveToMarkdown(urls);

        res.json({ 
            message: `Successfully processed ${results.filter(r => r.success).length} of ${urls.length} URLs`,
            results 
        });
    } catch (error) {
        console.error('Error processing URLs:', error);
        res.status(500).json({ error: 'Failed to process URLs' });
    }
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`WebSocket server is running on ws://localhost:${port}`);
    console.log(`WebSocket client available at http://localhost:${port}/client.html`);
    console.log(`Document viewer available at http://localhost:${port}/docs`);
});

// Serve the WebSocket client
app.get('/client.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'websocket-client.html'));
});

// Serve the document viewer
app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'document-viewer.html'));
});
