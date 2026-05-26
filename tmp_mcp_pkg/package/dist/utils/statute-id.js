/**
 * Chinese statute identifier handling.
 *
 * Chinese laws are identified by abbreviation-year format, e.g. "csl-2016".
 * Also supports lookup by Chinese name (e.g. "网络安全法") or English name.
 */
export function isValidStatuteId(id) {
    return id.length > 0 && id.trim().length > 0;
}
export function statuteIdCandidates(id) {
    const trimmed = id.trim().toLowerCase();
    const candidates = new Set();
    candidates.add(trimmed);
    candidates.add(id.trim());
    // Convert spaces/dashes to the other form
    if (trimmed.includes(' ')) {
        candidates.add(trimmed.replace(/\s+/g, '-'));
    }
    if (trimmed.includes('-')) {
        candidates.add(trimmed.replace(/-/g, ' '));
    }
    return [...candidates];
}
export function resolveExistingStatuteId(db, inputId) {
    // Try exact match first
    const exact = db.prepare("SELECT id FROM legal_documents WHERE id = ? LIMIT 1").get(inputId);
    if (exact)
        return exact.id;
    // Try case-insensitive ID match
    const lowerMatch = db.prepare("SELECT id FROM legal_documents WHERE LOWER(id) = LOWER(?) LIMIT 1").get(inputId);
    if (lowerMatch)
        return lowerMatch.id;
    // Try LIKE match on Chinese title
    const byTitle = db.prepare("SELECT id FROM legal_documents WHERE title LIKE ? LIMIT 1").get(`%${inputId}%`);
    if (byTitle)
        return byTitle.id;
    // Try LIKE match on English title
    const byTitleEn = db.prepare("SELECT id FROM legal_documents WHERE title_en LIKE ? LIMIT 1").get(`%${inputId}%`);
    if (byTitleEn)
        return byTitleEn.id;
    // Try LIKE match on short_name
    const byShortName = db.prepare("SELECT id FROM legal_documents WHERE short_name LIKE ? LIMIT 1").get(`%${inputId}%`);
    return byShortName?.id ?? null;
}
//# sourceMappingURL=statute-id.js.map