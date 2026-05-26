/**
 * Chinese legal citation validator.
 *
 * Validates a citation string against the database to ensure the document
 * and provision actually exist (zero-hallucination enforcement).
 */
import type { Database } from '@ansvar/mcp-sqlite';
import type { ValidationResult } from '../types/index.js';
export declare function validateCitation(db: Database, citation: string): ValidationResult;
//# sourceMappingURL=validator.d.ts.map