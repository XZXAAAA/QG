/**
 * list_sources — Returns metadata about data sources, coverage, and freshness.
 */
import type { Database } from '@ansvar/mcp-sqlite';
import { type ToolResponse } from '../utils/metadata.js';
export interface ListSourcesResult {
    jurisdiction: string;
    sources: Array<{
        name: string;
        authority: string;
        url: string;
        license: string;
        coverage: string;
    }>;
    database: {
        tier: string;
        schema_version: string;
        built_at: string;
        document_count: number;
        provision_count: number;
    };
    limitations: string[];
}
export declare function listSources(db: Database): Promise<ToolResponse<ListSourcesResult>>;
//# sourceMappingURL=list-sources.d.ts.map