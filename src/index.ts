#!/usr/bin/env node

import { Command } from 'commander';
import { InsightsDatabase } from './database.js';
import { createInsightsServer } from './server.js';
import { startStdioTransport } from './transports/stdio.js';
import { startHttpTransport } from './transports/http.js';

const program = new Command();

program
  .name('insights-mcp')
  .description('MCP server for persistent memory storage in Claude Code sessions')
  .version('1.0.0')
  .option('--mode <mode>', 'Transport mode (stdio|http)', process.env.INSIGHTS_MCP_MODE || 'stdio')
  .option('--db-path <path>', 'Database file path', process.env.INSIGHTS_MCP_DB_PATH)
  .option('--port <number>', 'HTTP port (only for http mode)', process.env.INSIGHTS_MCP_PORT || '3000')
  .action(async (options) => {
    const mode = options.mode as 'stdio' | 'http';

    if (mode !== 'stdio' && mode !== 'http') {
      console.error('Error: --mode must be either "stdio" or "http"');
      process.exit(1);
    }

    try {
      // Initialize database
      const db = new InsightsDatabase(options.dbPath);

      // Create MCP server
      const server = createInsightsServer(db, mode);

      // Start appropriate transport
      if (mode === 'stdio') {
        await startStdioTransport(server);
      } else {
        const port = parseInt(options.port, 10);
        if (Number.isNaN(port) || port < 1 || port > 65535) {
          console.error('Error: --port must be a valid port number (1-65535)');
          process.exit(1);
        }
        await startHttpTransport(server, port);
      }
    } catch (error) {
      console.error('Error starting server:', error);
      process.exit(1);
    }
  });

program.parse();
