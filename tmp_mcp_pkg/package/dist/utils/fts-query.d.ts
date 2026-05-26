/**
 * FTS5 query builder for Chinese Law MCP.
 *
 * Uses trigram tokenizer for CJK substring matching.
 * Trigram requires minimum 3-character queries. For shorter queries,
 * callers should fall back to LIKE-based search.
 *
 * Chinese text has no word boundaries (no spaces), so trigram is the
 * only reliable tokenizer for substring matching across compound terms
 * like 数据出境 (cross-border data transfer).
 */
/** Minimum characters for trigram FTS5 to work */
export declare const MIN_FTS_LENGTH = 3;
export interface FtsQueryVariants {
    primary: string;
    fallback?: string;
    /** True if query is too short for FTS5 trigram — caller should use LIKE */
    use_like: boolean;
}
export declare function buildFtsQueryVariants(query: string): FtsQueryVariants;
//# sourceMappingURL=fts-query.d.ts.map