#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Gitlab } from '@gitbeaker/rest';

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';

if (!GITLAB_TOKEN) {
  throw new Error('GITLAB_TOKEN environment variable is required');
}

// Initialize GitLab API client
const api = new Gitlab({
  token: GITLAB_TOKEN,
  host: GITLAB_URL,
});

interface GetMergeRequestContentArgs {
  project_id: string;
  merge_request_iid: number;
}

function validateGetMergeRequestContentArgs(args: unknown): asserts args is GetMergeRequestContentArgs {
  if (typeof args !== 'object' || args === null) {
    throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
  }
  
  const { project_id, merge_request_iid } = args as Record<string, unknown>;
  
  if (typeof project_id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'project_id must be a string');
  }
  
  if (typeof merge_request_iid !== 'number') {
    throw new McpError(ErrorCode.InvalidParams, 'merge_request_iid must be a number');
  }
}

class GitLabServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'gitlab-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_merge_request_content',
          description: 'Get the content of a merge request including its changes',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'The ID or URL-encoded path of the project'
              },
              merge_request_iid: {
                type: 'number',
                description: 'The internal ID of the merge request'
              }
            },
            required: ['project_id', 'merge_request_iid']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!request.params.arguments) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'No arguments provided'
        );
      }

      try {
        if (request.params.name === 'get_merge_request_content') {
          validateGetMergeRequestContentArgs(request.params.arguments);
          const { project_id, merge_request_iid } = request.params.arguments;

          // Get MR details
          const mr = await api.MergeRequests.show(project_id, merge_request_iid);
          
          // Get MR changes using the allDiffs method
          const diffs = await api.MergeRequests.allDiffs(project_id, merge_request_iid);
          
          // Format the response
          const content = {
            id: mr.id,
            iid: mr.iid,
            title: mr.title,
            description: mr.description,
            state: mr.state,
            source_branch: mr.source_branch,
            target_branch: mr.target_branch,
            changes: diffs.map((diff: any) => ({
              old_path: diff.old_path,
              new_path: diff.new_path,
              diff: diff.diff
            }))
          };

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(content, null, 2)
            }]
          };
        }

        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(
          ErrorCode.InternalError,
          `GitLab API error: ${errorMessage}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GitLab MCP server running on stdio');
  }
}

const server = new GitLabServer();
server.run().catch(console.error);
