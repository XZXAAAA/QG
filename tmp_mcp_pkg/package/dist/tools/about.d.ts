import type Database from '@ansvar/mcp-sqlite';
export interface AboutContext {
    version: string;
    fingerprint: string;
    dbBuilt: string;
}
export interface AboutResult {
    server: {
        name: string;
        package: string;
        version: string;
        suite: string;
        repository: string;
    };
    dataset: {
        fingerprint: string;
        built: string;
        jurisdiction: string;
        content_basis: string;
        counts: Record<string, number>;
    };
    provenance: {
        sources: string[];
        license: string;
        authenticity_note: string;
    };
    security: {
        access_model: string;
        network_access: boolean;
        filesystem_access: boolean;
        arbitrary_code: boolean;
    };
}
export declare function getAbout(db: InstanceType<typeof Database>, context: AboutContext): AboutResult;
//# sourceMappingURL=about.d.ts.map