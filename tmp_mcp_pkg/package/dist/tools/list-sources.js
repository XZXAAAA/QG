/**
 * list_sources — Returns metadata about data sources, coverage, and freshness.
 */
import { generateResponseMetadata } from '../utils/metadata.js';
function safeCount(db, sql) {
    try {
        const row = db.prepare(sql).get();
        return row ? Number(row.count) : 0;
    }
    catch {
        return 0;
    }
}
function safeMetaValue(db, key) {
    try {
        const row = db.prepare('SELECT value FROM db_metadata WHERE key = ?').get(key);
        return row?.value ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
}
export async function listSources(db) {
    const documentCount = safeCount(db, 'SELECT COUNT(*) as count FROM legal_documents');
    const provisionCount = safeCount(db, 'SELECT COUNT(*) as count FROM legal_provisions');
    return {
        results: {
            jurisdiction: 'People\'s Republic of China (CN)',
            sources: [
                {
                    name: 'NPC National Law Database (国家法律法规数据库)',
                    authority: 'National People\'s Congress of the PRC',
                    url: 'https://flk.npc.gov.cn',
                    license: 'Government Public Data',
                    coverage: 'All national laws adopted by the NPC and its Standing Committee, including Constitution, cybersecurity, data protection, company law, civil code, anti-monopoly, and e-commerce legislation.',
                },
                {
                    name: 'State Council / gov.cn',
                    authority: 'State Council of the PRC',
                    url: 'https://www.gov.cn',
                    license: 'Government Public Data',
                    coverage: 'Administrative regulations including CII protection, network data security management, and implementing regulations for major laws.',
                },
                {
                    name: 'Cyberspace Administration of China (CAC)',
                    authority: '国家互联网信息办公室',
                    url: 'https://www.cac.gov.cn',
                    license: 'Government Public Data',
                    coverage: 'Key CAC departmental rules including the Algorithm Recommendation Provisions, Deep Synthesis Provisions, Generative AI Measures, and Cybersecurity Review Measures.',
                },
            ],
            database: {
                tier: safeMetaValue(db, 'tier'),
                schema_version: safeMetaValue(db, 'schema_version'),
                built_at: safeMetaValue(db, 'built_at'),
                document_count: documentCount,
                provision_count: provisionCount,
            },
            limitations: [
                `Covers ${documentCount.toLocaleString()} Chinese laws and administrative regulations (NPC + State Council).`,
                'Content is in Chinese — the sole legally binding language under PRC law.',
                'CAC departmental rules coverage is limited to key AI/cybersecurity regulations. Other ministry rules (MIIT, SAMR, etc.) are not yet included.',
                'Judicial interpretations by the Supreme People\'s Court require professional tier.',
                'Content may lag behind the PRC Official Gazette.',
                'Always verify against official NPC or State Council publications when legal certainty is required.',
            ],
        },
        _metadata: generateResponseMetadata(db),
    };
}
//# sourceMappingURL=list-sources.js.map