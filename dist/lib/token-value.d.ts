import type { LocalVariable, LocalVariableCollection } from "@figma/rest-api-spec";
export declare function tokenTypeFromVariable(variable: LocalVariable): string;
export declare function tokenValueFromVariable(variable: LocalVariable, modeId: string, localVariables: Record<string, LocalVariable>): string | number | boolean;
export declare function getVariableValueForMode(variable: LocalVariable, modeId: string, collection: LocalVariableCollection, variables: Record<string, LocalVariable>): string | number | boolean;
