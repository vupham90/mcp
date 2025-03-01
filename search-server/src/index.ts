#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const API_KEY = process.env.BRAVE_API_KEY;

if (!API_KEY) {
  throw new Error('BRAVE_API_KEY environment variable is required');
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

// Create the MCP server
const server = new Server(
  {
    name: "search-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler that lists available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description: "Search the internet using Brave Search",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query"
            },
            count: {
              type: "number",
              description: "Number of results to return (1-20)",
              minimum: 1,
              maximum: 20,
              default: 5
            }
          },
          required: ["query"]
        }
      }
    ]
  };
});

// Handler for the search tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "search") {
    throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
  }

  const query = String(request.params.arguments?.query);
  const count = Number(request.params.arguments?.count) || 5;

  if (!query) {
    throw new McpError(ErrorCode.InvalidParams, "Search query is required");
  }

  try {
    const response = await axios.get<BraveSearchResponse>(BRAVE_SEARCH_URL, {
      headers: {
        'X-Subscription-Token': API_KEY
      },
      params: {
        q: query,
        count: count,
        text_decorations: false,
        text_format: "plain"
      }
    });

    if (!response.data.web?.results?.length) {
      return {
        content: [{
          type: "text",
          text: "No results found."
        }]
      };
    }

    const results = response.data.web.results.map(result => ({
      title: result.title,
      url: result.url,
      description: result.description
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2)
      }]
    };
  } catch (error) {
    console.error('Search API error:', error);
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      throw new McpError(
        ErrorCode.InternalError,
        "Search failed: Please visit https://api.search.brave.com to get started with Brave Search API"
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

// Start the server using stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Search MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
