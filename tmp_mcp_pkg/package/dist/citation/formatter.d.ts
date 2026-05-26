/**
 * Chinese legal citation formatter.
 *
 * Formats:
 *   chinese:  "第三条 中华人民共和国网络安全法"
 *   english:  "Article 3, Cybersecurity Law of the People's Republic of China"
 *   full:     "Article 3, Cybersecurity Law (CSL 2016)"
 *   short:    "Art. 3 CSL 2016"
 *   pinpoint: "Art. 3, Para. 1"
 */
import type { ParsedCitation, CitationFormat } from '../types/index.js';
export declare function formatCitation(parsed: ParsedCitation, format?: CitationFormat): string;
//# sourceMappingURL=formatter.d.ts.map