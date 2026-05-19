import type { GetLocalVariablesResponse, PublishedStyle } from "@figma/rest-api-spec";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export interface GetFileStylesResponse {
  meta: { styles: PublishedStyle[] };
}

export interface GetFileNodesResponse {
  nodes: Record<string, { document: Record<string, unknown> }>;
}

async function figmaFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { "X-Figma-Token": accessToken } });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Figma API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response.json() as Promise<T>;
}

export function getLocalVariables(
  fileId: string,
  accessToken: string
): Promise<GetLocalVariablesResponse> {
  return figmaFetch(`${FIGMA_API_BASE}/files/${fileId}/variables/local`, accessToken);
}

export function getFileStyles(
  fileId: string,
  accessToken: string
): Promise<GetFileStylesResponse> {
  return figmaFetch(`${FIGMA_API_BASE}/files/${fileId}/styles`, accessToken);
}

export function getFileNodes(
  fileId: string,
  nodeIds: string[],
  accessToken: string
): Promise<GetFileNodesResponse> {
  return figmaFetch(`${FIGMA_API_BASE}/files/${fileId}/nodes?ids=${nodeIds.join(",")}`, accessToken);
}
