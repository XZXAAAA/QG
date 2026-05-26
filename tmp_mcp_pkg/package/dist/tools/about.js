function safeCount(db, sql) {
    try {
        const row = db.prepare(sql).get();
        return row ? Number(row.count) : 0;
    }
    catch {
        return 0;
    }
}
export function getAbout(db, context) {
    return {
        server: {
            name: 'Chinese Law MCP',
            package: '@ansvar/chinese-law-mcp',
            version: context.version,
            suite: 'Ansvar Compliance Suite',
            repository: 'https://github.com/Ansvar-Systems/chinese-law-mcp',
        },
        dataset: {
            fingerprint: context.fingerprint,
            built: context.dbBuilt,
            jurisdiction: 'People\'s Republic of China (CN)',
            content_basis: 'Chinese law text from flk.npc.gov.cn (NPC National Law Database) and gov.cn (State Council). ' +
                'Covers national laws and administrative regulations in cybersecurity, data protection, commercial, and competition law.',
            counts: {
                legal_documents: safeCount(db, 'SELECT COUNT(*) as count FROM legal_documents'),
                legal_provisions: safeCount(db, 'SELECT COUNT(*) as count FROM legal_provisions'),
            },
        },
        provenance: {
            sources: [
                'flk.npc.gov.cn (NPC National Law Database — national laws)',
                'gov.cn (State Council — administrative regulations)',
            ],
            license: 'Apache-2.0 (server code). Law text is public domain under Chinese law.',
            authenticity_note: 'Law text is derived from official NPC and State Council publications. ' +
                'The Chinese text is the sole legally binding version. Content may lag behind PRC Official Gazette. ' +
                'Verify against official publications when legal certainty is required.',
        },
        security: {
            access_model: 'read-only',
            network_access: false,
            filesystem_access: false,
            arbitrary_code: false,
        },
    };
}
//# sourceMappingURL=about.js.map