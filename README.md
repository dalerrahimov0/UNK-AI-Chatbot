# Chatbot Application

A Node.js chatbot application with both REST API and WebSocket support.

## Features

- REST API for question answering
- WebSocket support for real-time group chat
- Context-aware responses based on markdown documents
- Academic advising support with example knowledge base
- Vector database storage with Pinecone Local for semantic search
- Docker support for running Pinecone Local vector database

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_key_here
   PORT=3000
   PINECONE_API_KEY=pclocal
   ```
4. Start the Pinecone database with Docker:
   ```
   npm run docker:start
   ```
5. Start the server:
   ```
   npm start
   ```

To stop the Pinecone database:
```
npm run docker:stop
```

## REST API Usage

### Health Check
```
GET /health
```

### Ask a Question
```
POST /api/ask
Content-Type: application/json

{
    "topic": "Academic Advising",
    "question": "How do I change my major?"
}
```

## WebSocket Usage

Connect to `ws://localhost:3000`

### Join a Group
```json
{
    "type": "join",
    "group": "academic"
}
```

### Send a Question
```json
{
    "type": "question",
    "topic": "Academic Advising",
    "question": "How do I change my major?"
}
```

### Send a Broadcast Message
```json
{
    "type": "broadcast",
    "username": "JohnDoe",
    "message": "Hello everyone in the group!"
}
```

### Response Types
- `system`: System messages
- `status`: Processing status updates
- `answer`: Question/answer responses (AI-generated)
- `broadcast`: Direct user messages
- `error`: Error messages

## Test Client

A test client is available at:
```
http://localhost:3000/client.html
```

## Postman Collection

A Postman collection is included for testing both the REST API and WebSocket functionality:
- Import `postman_collection.json` into Postman
- Use the "Run in Postman" button for WebSocket testing

## Project Structure

- `index.js`: Express server and WebSocket handling
- `bot.js`: OpenAI integration and chatbot logic with Pinecone Local vector database
- `docs/`: Markdown knowledge base
- `websocket-client.html`: Test client for WebSocket
- `docker-compose.yml`: Docker configuration for Pinecone Local database
