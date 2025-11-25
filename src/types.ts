export interface Insight {
  id: string;                    // UUID v4
  content: string;               // Min 3 characters
  context: string;               // Absolute path or 'global'
  metadata?: Record<string, any>; // Flexible JSON metadata
  created_at: number;            // Unix timestamp
  updated_at: number;            // Unix timestamp
}

export interface SearchResult {
  results: Insight[];
  total: number;
  hasMore: boolean;
}

export interface TransportMode {
  mode: 'stdio' | 'http';
  port?: number;
  dbPath: string;
}
