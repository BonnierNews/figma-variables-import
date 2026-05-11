export interface SyncOptions {
    figmaToken: string;
    figmaFileId: string;
    /** Absolute path where raw W3C token JSON files are written */
    tokensOutputPath: string;
    /** Absolute path where Style Dictionary output is written */
    jsonOutputPath: string;
    /** Collection names to skip entirely */
    excludedCollections?: Set<string> | string[];
    /** Path to a Style Dictionary v5 config file. Takes full precedence over sdTransforms/sdOutputFormat when set */
    sdConfigPath?: string;
    /** Style Dictionary transform names to apply (default: attribute/cti, name/kebab, size/rem) */
    sdTransforms?: string[];
    /** Style Dictionary output format (default: json/nested) */
    sdOutputFormat?: string;
}
export declare function syncFigmaTokens(options: SyncOptions): Promise<void>;
