import type { GetLocalVariablesResponse, LocalVariable, LocalVariableCollection } from "@figma/rest-api-spec";
import type { TokensFile, BrandTokenFiles } from "./types.ts";
export declare function collectReferencedVariableIds(variableIds: string[], variables: Record<string, LocalVariable>, collected?: Set<string>): Set<string>;
export declare function generateTokenForVariable(variable: LocalVariable, modeId: string, modeName: string, collection: LocalVariableCollection | null, variables: Record<string, LocalVariable>, tokenFiles: Record<string, TokensFile>): void;
export declare function tokenFilesFromLocalVariables(localVariablesResponse: GetLocalVariablesResponse, excludedCollections: Set<string>): BrandTokenFiles;
