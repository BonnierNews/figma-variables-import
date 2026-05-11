import type { RGBA } from "@figma/rest-api-spec";

export function rgbToHex({ r, g, b, a }: RGBA): string {
  const toHex = (value: number): string => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  const hex = [ toHex(r), toHex(g), toHex(b) ].join("");
  return `#${hex}${a !== 1 ? toHex(a) : ""}`;
}
