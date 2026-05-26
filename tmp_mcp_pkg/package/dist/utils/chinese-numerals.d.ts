/**
 * Chinese numeral conversion utilities.
 *
 * Converts between Chinese numerals (一, 二, 三, ...) and Arabic numbers.
 * Chinese law uses 第N条 format for article references:
 *   第一条 = Article 1
 *   第二十一条 = Article 21
 *   第一百零三条 = Article 103
 */
/**
 * Convert a Chinese numeral string to an Arabic number.
 * Examples:
 *   一 -> 1
 *   十 -> 10
 *   十一 -> 11
 *   二十一 -> 21
 *   一百 -> 100
 *   一百零三 -> 103
 *   二百五十六 -> 256
 */
export declare function chineseToArabic(chinese: string): number;
/**
 * Convert an Arabic number to a Chinese numeral string.
 * Examples:
 *   1 -> 一
 *   10 -> 十
 *   11 -> 十一
 *   21 -> 二十一
 *   100 -> 一百
 *   103 -> 一百零三
 */
export declare function arabicToChinese(num: number): string;
/**
 * Extract article number from a Chinese article reference.
 * Examples:
 *   "第一条" -> 1
 *   "第二十一条" -> 21
 *   "第一百零三条" -> 103
 *   "第三条第一款" -> 3 (article only; paragraph handled separately)
 */
export declare function extractArticleNumber(ref: string): number | null;
/**
 * Extract paragraph number from a Chinese article reference.
 * Examples:
 *   "第三条第一款" -> 1
 *   "第三条第二款" -> 2
 */
export declare function extractParagraphNumber(ref: string): number | null;
/**
 * Build a Chinese article reference string.
 * Examples:
 *   buildChineseRef(3) -> "第三条"
 *   buildChineseRef(21, 1) -> "第二十一条第一款"
 */
export declare function buildChineseRef(article: number, paragraph?: number): string;
//# sourceMappingURL=chinese-numerals.d.ts.map