/**
 * Chinese legal citation parser.
 *
 * Parses citations in multiple formats:
 *   1. Chinese: "第三条 中华人民共和国网络安全法"
 *   2. English: "Article 3, Cybersecurity Law of the People's Republic of China"
 *   3. Short:   "Art. 3, CSL 2016"
 *   4. ID-based: "csl-2016, art. 3"
 *   5. With paragraph: "Article 3, Paragraph 1" / "第三条第一款"
 */
import type { ParsedCitation } from '../types/index.js';
export declare function parseCitation(citation: string): ParsedCitation;
//# sourceMappingURL=parser.d.ts.map