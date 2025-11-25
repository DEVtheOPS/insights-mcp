import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InsightsDatabase } from './database.js';
import { Insight } from './types.js';

export function createInsightsServer(db: InsightsDatabase, mode: 'stdio' | 'http'): McpServer {
  const server = new McpServer({
    name: 'insights-mcp',
    version: '1.0.0'
  });

  // Helper to get context with mode-aware validation
  const getContext = (providedContext?: string): string => {
    if (mode === 'http' && !providedContext) {
      throw new Error('context parameter is required in HTTP mode');
    }
    return providedContext || process.cwd();
  };

  // Define Insight schema for output
  const InsightSchema = z.object({
    id: z.string(),
    content: z.string(),
    context: z.string(),
    metadata: z.record(z.any()).optional(),
    created_at: z.number(),
    updated_at: z.number()
  });

  // Tool 2: search-insights
  server.registerTool(
    'search-insights',
    {
      title: 'Search Insights',
      description: 'Full-text search for insights using FTS5',
      inputSchema: {
        query: z.string().min(3).describe('Search query'),
        context: z.string().optional().describe('Filter by context. Required in HTTP mode.'),
        limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
        offset: z.number().min(0).default(0).describe('Pagination offset')
      },
      outputSchema: {
        results: z.array(InsightSchema).describe('Matching insights'),
        total: z.number().describe('Total matching results'),
        hasMore: z.boolean().describe('Whether more results exist')
      }
    },
    async ({ query, context, limit, offset }) => {
      const resolvedContext = context ? getContext(context) : undefined;
      const output = db.search(query, resolvedContext, limit ?? 20, offset ?? 0);

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  // Tool 3: list-insights
  server.registerTool(
    'list-insights',
    {
      title: 'List Insights',
      description: 'List all insights for a context in chronological order',
      inputSchema: {
        context: z.string().optional().describe('Filter by context. Required in HTTP mode.'),
        limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
        offset: z.number().min(0).default(0).describe('Pagination offset')
      },
      outputSchema: {
        results: z.array(InsightSchema).describe('Insights for context'),
        total: z.number().describe('Total insights in context'),
        hasMore: z.boolean().describe('Whether more results exist')
      }
    },
    async ({ context, limit, offset }) => {
      const resolvedContext = context ? getContext(context) : undefined;
      const output = db.list(resolvedContext, limit ?? 20, offset ?? 0);

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );

  return server;
}
