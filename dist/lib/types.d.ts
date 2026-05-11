export interface Token {
    $type: string;
    $value: string | number | boolean;
    $description?: string;
    $extensions?: {
        "com.figma": {
            hiddenFromPublishing: boolean;
            scopes: string[];
            codeSyntax: Record<string, string>;
        };
    };
}
export interface TokensFile {
    [key: string]: TokensFile | Token;
}
export interface BrandTokenFiles {
    [brandName: string]: Record<string, TokensFile>;
}
export interface FigmaCollectionExtras {
    parentVariableCollectionId?: string;
    isExtension?: boolean;
    variableOverrides?: Record<string, Record<string, unknown>>;
}
