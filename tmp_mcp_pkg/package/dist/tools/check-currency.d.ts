/**
 * check_currency — Check if a Chinese law is current (in force).
 */
import type { Database } from '@ansvar/mcp-sqlite';
import { type ToolResponse } from '../utils/metadata.js';
export interface CheckCurrencyInput {
    document_id: string;
    provision_ref?: string;
    as_of_date?: string;
}
export interface CurrencyResult {
    document_id: string;
    title: string;
    title_en: string | null;
    status: string;
    type: string;
    issued_date: string | null;
    in_force_date: string | null;
    is_current: boolean;
    provision_exists?: boolean;
    warnings: string[];
}
export declare function checkCurrency(db: Database, input: CheckCurrencyInput): Promise<ToolResponse<CurrencyResult | null>>;
//# sourceMappingURL=check-currency.d.ts.map