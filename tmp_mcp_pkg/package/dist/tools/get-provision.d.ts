/**
 * get_provision — Retrieve a specific provision from a Chinese law.
 * Supports article references in both Chinese (第三条) and Arabic (3) format.
 */
import type { Database } from '@ansvar/mcp-sqlite';
import { type ToolResponse } from '../utils/metadata.js';
export interface GetProvisionInput {
    document_id: string;
    article?: string;
    section?: string;
    provision_ref?: string;
}
export interface ProvisionResult {
    document_id: string;
    document_title: string;
    document_title_en: string | null;
    document_status: string;
    provision_ref: string;
    chapter: string | null;
    section: string;
    title: string | null;
    content: string;
}
export declare function getProvision(db: Database, input: GetProvisionInput): Promise<ToolResponse<ProvisionResult | ProvisionResult[] | {
    provisions: ProvisionResult[];
    truncated: boolean;
    total: number;
} | null>>;
//# sourceMappingURL=get-provision.d.ts.map