/**
 * Runtime capability detection for Chinese Law MCP.
 * Detects which database tables are available to enable/disable features.
 */
import type Database from '@ansvar/mcp-sqlite';
export type Capability = 'core_legislation' | 'judicial_interpretations' | 'departmental_rules';
export declare function detectCapabilities(db: InstanceType<typeof Database>): Set<Capability>;
export interface DbMetadata {
    tier: string;
    schema_version: string;
    built_at?: string;
    builder?: string;
}
export declare function readDbMetadata(db: InstanceType<typeof Database>): DbMetadata;
export declare function upgradeMessage(feature: string): string;
//# sourceMappingURL=capabilities.d.ts.map