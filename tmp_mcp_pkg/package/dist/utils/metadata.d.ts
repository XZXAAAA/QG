/**
 * Response metadata for Chinese Law MCP tool responses.
 */
import type Database from '@ansvar/mcp-sqlite';
export interface ResponseMetadata {
    data_freshness: string;
    disclaimer: string;
    source_authority: string;
}
export interface ToolResponse<T> {
    results: T;
    _metadata: ResponseMetadata;
}
export declare function generateResponseMetadata(db?: InstanceType<typeof Database>): ResponseMetadata;
//# sourceMappingURL=metadata.d.ts.map