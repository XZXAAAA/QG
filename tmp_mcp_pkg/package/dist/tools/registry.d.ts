/**
 * Tool registry for Chinese Law MCP Server.
 * Shared between stdio (index.ts) and HTTP (api/mcp.ts) entry points.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import Database from '@ansvar/mcp-sqlite';
import { type AboutContext } from './about.js';
export type { AboutContext } from './about.js';
export declare const TOOLS: Tool[];
export declare function buildTools(context?: AboutContext): Tool[];
export declare function registerTools(server: Server, db: InstanceType<typeof Database>, context?: AboutContext): void;
//# sourceMappingURL=registry.d.ts.map