#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Octokit } from '@octokit/rest';

class GitHubServer {
  private server: Server;
  private octokit: Octokit;

  constructor() {
    // Initialize Octokit without auth for public repo access
    this.octokit = new Octokit();

    this.server = new Server(
      {
        name: 'github-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
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
          name: 'read_file',
          description: 'Read a file from a GitHub repository',
          inputSchema: {
            type: 'object',
            properties: {
              owner: {
                type: 'string',
                description: 'Repository owner',
              },
              repo: {
                type: 'string',
                description: 'Repository name',
              },
              path: {
                type: 'string',
                description: 'File path in the repository',
              },
              ref: {
                type: 'string',
                description: 'Git reference (branch, tag, or commit SHA)',
                default: 'main',
              },
            },
            required: ['owner', 'repo', 'path'],
          },
        },
        {
          name: 'search_code',
          description: 'Search for code across GitHub repositories',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              language: {
                type: 'string',
                description: 'Programming language to filter by',
              },
              owner: {
                type: 'string',
                description: 'Repository owner to limit search to',
              },
              repo: {
                type: 'string',
                description: 'Repository name to limit search to',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_repository_content',
          description: 'List contents of a repository directory',
          inputSchema: {
            type: 'object',
            properties: {
              owner: {
                type: 'string',
                description: 'Repository owner',
              },
              repo: {
                type: 'string',
                description: 'Repository name',
              },
              path: {
                type: 'string',
                description: 'Directory path in the repository',
                default: '',
              },
              ref: {
                type: 'string',
                description: 'Git reference (branch, tag, or commit SHA)',
                default: 'main',
              },
            },
            required: ['owner', 'repo'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'read_file': {
            const args = request.params.arguments as {
              owner: string;
              repo: string;
              path: string;
              ref?: string;
            };
            const { owner, repo, path, ref = 'main' } = args;
            const response = await this.octokit.repos.getContent({
              owner,
              repo,
              path,
              ref,
            });

            if ('content' in response.data && typeof response.data.content === 'string') {
              const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
              return {
                content: [
                  {
                    type: 'text',
                    text: content,
                  },
                ],
              };
            }
            throw new McpError(ErrorCode.InternalError, 'Invalid response format from GitHub API');
          }

          case 'search_code': {
            const args = request.params.arguments as {
              query: string;
              language?: string;
              owner?: string;
              repo?: string;
            };
            const { query, language, owner, repo } = args;
            let q = query;
            if (language) q += ` language:${language}`;
            if (owner && repo) q += ` repo:${owner}/${repo}`;
            else if (owner) q += ` user:${owner}`;

            const response = await this.octokit.search.code({
              q,
              per_page: 10,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response.data.items.map(item => ({
                    repository: item.repository.full_name,
                    path: item.path,
                    url: item.html_url,
                  })), null, 2),
                },
              ],
            };
          }

          case 'list_repository_content': {
            const args = request.params.arguments as {
              owner: string;
              repo: string;
              path?: string;
              ref?: string;
            };
            const { owner, repo, path = '', ref = 'main' } = args;
            const response = await this.octokit.repos.getContent({
              owner,
              repo,
              path,
              ref,
            });

            if (Array.isArray(response.data)) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(response.data.map(item => ({
                      name: item.name,
                      type: item.type,
                      path: item.path,
                      size: item.size,
                    })), null, 2),
                  },
                ],
              };
            }
            throw new McpError(ErrorCode.InternalError, 'Expected directory listing');
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          `GitHub API error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GitHub MCP server running on stdio');
  }
}

const server = new GitHubServer();
server.run().catch(console.error);
