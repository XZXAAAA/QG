/**
 * Chinese statute identifier handling.
 *
 * Chinese laws are identified by abbreviation-year format, e.g. "csl-2016".
 * Also supports lookup by Chinese name (e.g. "网络安全法") or English name.
 */
import type { Database } from '@ansvar/mcp-sqlite';
export declare function isValidStatuteId(id: string): boolean;
export declare function statuteIdCandidates(id: string): string[];
export declare function resolveExistingStatuteId(db: Database, inputId: string): string | null;
//# sourceMappingURL=statute-id.d.ts.map