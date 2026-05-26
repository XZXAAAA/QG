/**
 * build_legal_stance — Aggregate citations for a legal question.
 * Uses FTS5 trigram for CJK substring matching with LIKE fallback.
 */
import { buildFtsQueryVariants } from '../utils/fts-query.js';
import { generateResponseMetadata } from '../utils/metadata.js';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
export async function buildLegalStance(db, input) {
    if (!input.query || input.query.trim().length === 0) {
        return {
            results: { query: '', provisions: [], total_citations: 0 },
            _metadata: generateResponseMetadata(db)
        };
    }
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const queryVariants = buildFtsQueryVariants(input.query);
    // For short queries, use LIKE-based search
    if (queryVariants.use_like) {
        return buildStanceWithLike(db, input, limit);
    }
    let provSql = `
    SELECT
      lp.document_id,
      ld.title as document_title,
      lp.provision_ref,
      lp.title,
      snippet(provisions_fts, 0, '>>>', '<<<', '...', 32) as snippet,
      bm25(provisions_fts) as relevance
    FROM provisions_fts
    JOIN legal_provisions lp ON lp.id = provisions_fts.rowid
    JOIN legal_documents ld ON ld.id = lp.document_id
    WHERE provisions_fts MATCH ?
  `;
    const provParams = [];
    if (input.document_id) {
        provSql += ` AND lp.document_id = ?`;
        provParams.push(input.document_id);
    }
    provSql += ` ORDER BY relevance LIMIT ?`;
    provParams.push(limit);
    const runProvisionQuery = (ftsQuery) => {
        const bound = [ftsQuery, ...provParams];
        return db.prepare(provSql).all(...bound);
    };
    let provisions = runProvisionQuery(queryVariants.primary);
    if (provisions.length === 0 && queryVariants.fallback) {
        provisions = runProvisionQuery(queryVariants.fallback);
    }
    return {
        results: {
            query: input.query,
            provisions,
            total_citations: provisions.length,
        },
        _metadata: generateResponseMetadata(db)
    };
}
/** LIKE-based fallback for queries too short for trigram FTS5 */
function buildStanceWithLike(db, input, limit) {
    let sql = `
    SELECT
      lp.document_id,
      ld.title as document_title,
      lp.provision_ref,
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
    sql += ` LIMIT ?`;
    params.push(limit);
    const provisions = db.prepare(sql).all(...params);
    return {
        results: {
            query: input.query,
            provisions,
            total_citations: provisions.length,
        },
        _metadata: generateResponseMetadata(db)
    };
}
//# sourceMappingURL=build-legal-stance.js.map