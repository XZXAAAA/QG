/**
 * build_legal_stance — Aggregate citations for a legal question.
 * Uses FTS5 trigram for CJK substring matching with LIKE fallback.
 */
import type { Database } from '@ansvar/mcp-sqlite';
import { type ToolResponse } from '../utils/metadata.js';
export interface BuildLegalStanceInput {
    query: string;
    document_id?: string;
    as_of_date?: string;
    limit?: number;
}
interface ProvisionHit {
    document_id: string;
    document_title: string;
    provision_ref: string;
    title: string | null;
    snippet: string;
    relevance: number;
}
export interface LegalStanceResult {
    query: string;
    provisions: ProvisionHit[];
    total_citations: number;
}
export declare function buildLegalStance(db: Database, input: BuildLegalStanceInput): Promise<ToolResponse<LegalStanceResult>>;
export {};
//# sourceMappingURL=build-legal-stance.d.ts.map