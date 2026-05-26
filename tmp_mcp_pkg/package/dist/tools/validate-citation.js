/**
 * validate_citation — Validate a Chinese legal citation against the database.
 */
import { validateCitation as doValidate } from '../citation/validator.js';
import { formatCitation } from '../citation/formatter.js';
import { generateResponseMetadata } from '../utils/metadata.js';
export async function validateCitationTool(db, input) {
    if (!input.citation || input.citation.trim().length === 0) {
        return {
            results: {
                citation: input.citation,
                formatted_citation: '',
                formatted_citation_chinese: '',
                valid: false,
                document_exists: false,
                provision_exists: false,
                warnings: ['Empty citation'],
            },
            _metadata: generateResponseMetadata(db)
        };
    }
    const result = doValidate(db, input.citation);
    const formatted = formatCitation(result.citation, 'full');
    const formattedChinese = formatCitation(result.citation, 'chinese');
    return {
        results: {
            citation: input.citation,
            formatted_citation: formatted,
            formatted_citation_chinese: formattedChinese,
            valid: result.citation.valid && result.document_exists && result.provision_exists,
            document_exists: result.document_exists,
            provision_exists: result.provision_exists,
            document_title: result.document_title,
            status: result.status,
            warnings: result.warnings,
        },
        _metadata: generateResponseMetadata(db)
    };
}
//# sourceMappingURL=validate-citation.js.map