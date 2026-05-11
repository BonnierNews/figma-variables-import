export interface StyleDictionaryOptions {
    tokensOutputPath: string;
    jsonOutputPath: string;
    sdConfigPath: string | null;
    sdTransforms: string[];
    sdOutputFormat: string;
}
export declare function runStyleDictionary(options: StyleDictionaryOptions): Promise<void>;
