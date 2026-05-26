/**
 * Runtime capability detection for Chinese Law MCP.
 * Detects which database tables are available to enable/disable features.
 */
const TABLE_MAP = {
    core_legislation: ['legal_documents', 'legal_provisions', 'provisions_fts'],
    judicial_interpretations: ['judicial_interpretations'],
    departmental_rules: ['departmental_rules'],
};
export function detectCapabilities(db) {
    const caps = new Set();
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .map(r => r.name));
    for (const [cap, required] of Object.entries(TABLE_MAP)) {
        if (required.every(t => tables.has(t))) {
            caps.add(cap);
        }
    }
    return caps;
}
export function readDbMetadata(db) {
    const meta = {};
    try {
        const rows = db.prepare('SELECT key, value FROM db_metadata').all();
        for (const row of rows) {
            meta[row.key] = row.value;
        }
    }
    catch {
        // db_metadata table may not exist
    }
    return {
        tier: meta.tier ?? 'free',
        schema_version: meta.schema_version ?? '1.0',
        built_at: meta.built_at,
        builder: meta.builder,
    };
}
export function upgradeMessage(feature) {
    return `The "${feature}" feature requires a professional-tier database. Contact hello@ansvar.eu for access.`;
}
//# sourceMappingURL=capabilities.js.map