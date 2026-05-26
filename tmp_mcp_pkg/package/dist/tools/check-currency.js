/**
 * check_currency — Check if a Chinese law is current (in force).
 */
import { generateResponseMetadata } from '../utils/metadata.js';
export async function checkCurrency(db, input) {
    if (!input.document_id) {
        throw new Error('document_id is required');
    }
    const doc = db.prepare(`
    SELECT id, title, title_en, status, type, issued_date, in_force_date
    FROM legal_documents
    WHERE id = ? OR title LIKE ? OR title_en LIKE ? OR short_name LIKE ?
    LIMIT 1
  `).get(input.document_id, `%${input.document_id}%`, `%${input.document_id}%`, `%${input.document_id}%`);
    if (!doc) {
        return {
            results: null,
            _metadata: generateResponseMetadata(db)
        };
    }
    const warnings = [];
    const isCurrent = doc.status === 'in_force';
    if (doc.status === 'repealed') {
        warnings.push('This statute has been repealed');
    }
    if (doc.status === 'amended') {
        warnings.push('This statute has been amended. Ensure you are referencing the current consolidated version.');
    }
    let provisionExists;
    if (input.provision_ref) {
        const prov = db.prepare('SELECT 1 FROM legal_provisions WHERE document_id = ? AND (provision_ref = ? OR section = ?)').get(doc.id, input.provision_ref, input.provision_ref);
        provisionExists = !!prov;
        if (!provisionExists) {
            warnings.push(`Provision "${input.provision_ref}" not found in this document`);
        }
    }
    return {
        results: {
            document_id: doc.id,
            title: doc.title,
            title_en: doc.title_en,
            status: doc.status,
            type: doc.type,
            issued_date: doc.issued_date,
            in_force_date: doc.in_force_date,
            is_current: isCurrent,
            provision_exists: provisionExists,
            warnings,
        },
        _metadata: generateResponseMetadata(db)
    };
}
//# sourceMappingURL=check-currency.js.map