/**
 * search_legislation — Full-text search across Chinese law provisions.
 * Uses FTS5 trigram tokenizer for CJK substring matching.
 * Falls back to LIKE for queries shorter than 3 characters.
 */
import type { Database } from '@ansvar/mcp-sqlite';
import { type ToolResponse } from '../utils/metadata.js';
export interface SearchLegislationInput {
    query: string;
    document_id?: string;
    status?: string;
    as_of_date?: string;
    limit?: number;
}
export interface SearchLegislationResult {
    document_id: string;
    document_title: string;
    provision_ref: string;
    chapter: string | null;
    section: string;
    title: string | null;
    snippet: string;
    relevance: number;
}
export declare function searchLegislation(db: Database, input: SearchLegislationInput): Promise<ToolResponse<SearchLegislationResult[]>>;
//# sourceMappingURL=search-legislation.d.ts.map