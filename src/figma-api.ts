import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export async function getLocalVariables(
  fileId: string,
  accessToken: string
): Promise<GetLocalVariablesResponse> {
  const response = await fetch(
    `${FIGMA_API_BASE}/files/${fileId}/variables/local`,
    { headers: { "X-Figma-Token": accessToken } }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Figma API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response.json() as Promise<GetLocalVariablesResponse>;
}
