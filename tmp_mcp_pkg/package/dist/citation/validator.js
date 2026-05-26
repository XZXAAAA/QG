/**
 * Chinese legal citation validator.
 *
 * Validates a citation string against the database to ensure the document
 * and provision actually exist (zero-hallucination enforcement).
 */
import { parseCitation } from './parser.js';
export function validateCitation(db, citation) {
    const parsed = parseCitation(citation);
    const warnings = [];
    if (!parsed.valid) {
        return {
            citation: parsed,
            document_exists: false,
            provision_exists: false,
            warnings: [parsed.error ?? 'Invalid citation format'],
        };
    }
    // Look up document by title match (Chinese or English)
    const searchTitle = parsed.title ?? parsed.title_en ?? '';
    const doc = db.prepare("SELECT id, title, title_en, status FROM legal_documents WHERE title LIKE ? OR title_en LIKE ? OR short_name LIKE ? OR id LIKE ? LIMIT 1").get(`%${searchTitle}%`, `%${searchTitle}%`, `%${searchTitle}%`, `%${searchTitle}%`);
    if (!doc) {
        return {
            citation: parsed,
            document_exists: false,
            provision_exists: false,
            warnings: [`Document "${searchTitle}" not found in database`],
        };
    }
    if (doc.status === 'repealed') {
        warnings.push('This statute has been repealed');
    }
    // Check provision existence
    let provisionExists = false;
    if (parsed.article) {
        const provisionRef = parsed.article;
        const prov = db.prepare(`SELECT 1 FROM legal_provisions
       WHERE document_id = ?
       AND (provision_ref = ? OR section = ? OR provision_ref LIKE ?)`).get(doc.id, provisionRef, provisionRef, `%art${provisionRef}%`);
        provisionExists = !!prov;
        if (!provisionExists) {
            warnings.push(`Article ${provisionRef} not found in ${doc.title}`);
        }
    }
    return {
        citation: parsed,
        document_exists: true,
        provision_exists: provisionExists,
        document_title: doc.title,
        status: doc.status,
        warnings,
    };
}
//# sourceMappingURL=validator.js.map