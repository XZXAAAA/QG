/**
 * search_legislation — Full-text search across Chinese law provisions.
 * Uses FTS5 trigram tokenizer for CJK substring matching.
 * Falls back to LIKE for queries shorter than 3 characters.
 */
import { buildFtsQueryVariants } from '../utils/fts-query.js';
import { normalizeAsOfDate } from '../utils/as-of-date.js';
import { generateResponseMetadata } from '../utils/metadata.js';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
export async function searchLegislation(db, input) {
    if (!input.query || input.query.trim().length === 0) {
        return {
            results: [],
            _metadata: generateResponseMetadata(db)
        };
    }
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const queryVariants = buildFtsQueryVariants(input.query);
    if (input.as_of_date)
        normalizeAsOfDate(input.as_of_date);
    // For short queries, fall back to LIKE-based search
    if (queryVariants.use_like) {
        return searchWithLike(db, input, limit);
    }
    let sql = `
    SELECT
      lp.document_id,
      ld.title as document_title,
      lp.provision_ref,
      lp.chapter,
      lp.section,
      lp.title,
      snippet(provisions_fts, 0, '>>>', '<<<', '...', 32) as snippet,
      bm25(provisions_fts) as relevance
    FROM provisions_fts
    JOIN legal_provisions lp ON lp.id = provisions_fts.rowid
    JOIN legal_documents ld ON ld.id = lp.document_id
    WHERE provisions_fts MATCH ?
  `;
    const params = [];
    if (input.document_id) {
        sql += ` AND lp.document_id = ?`;
        params.push(input.document_id);
    }
    if (input.status) {
        sql += ` AND ld.status = ?`;
        params.push(input.status);
    }
    sql += ` ORDER BY relevance LIMIT ?`;
    params.push(limit);
    const runQuery = (ftsQuery) => {
        const bound = [ftsQuery, ...params];
        return db.prepare(sql).all(...bound);
    };
    const primaryResults = runQuery(queryVariants.primary);
    const results = (primaryResults.length > 0 || !queryVariants.fallback)
        ? primaryResults
        : runQuery(queryVariants.fallback);
    return {
        results,
        _metadata: generateResponseMetadata(db)
    };
}
/** LIKE-based fallback for queries too short for trigram FTS5 */
function searchWithLike(db, input, limit) {
    let sql = `
    SELECT
      lp.document_id,
      ld.title as document_title,
      lp.provision_ref,
      lp.chapter,
      lp.section,
      lp.title,
      substr(lp.content, 1, 200) as snippet,
      0 as relevance
    FROM legal_provisions lp
    JOIN legal_documents ld ON ld.id = lp.document_id
    WHERE lp.content LIKE ?
  `;
    const params = [`%${input.query.trim()}%`];
    if (input.document_id) {
        sql += ` AND lp.document_id = ?`;
        params.push(input.document_id);
    }
    if (input.status) {
        sql += ` AND ld.status = ?`;
        params.push(input.status);
    }
    sql += ` LIMIT ?`;
    params.push(limit);
    const results = db.prepare(sql).all(...params);
    return {
        results,
        _metadata: generateResponseMetadata(db)
    };
}
//# sourceMappingURL=search-legislation.js.map