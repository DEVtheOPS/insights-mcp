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

  return server;
}
