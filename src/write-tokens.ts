import fs from "node:fs";
import path from "node:path";

import type { BrandTokenFiles } from "./types.ts";

export function writeTokenFiles(files: BrandTokenFiles, baseDir: string): void {
  fs.rmSync(baseDir, { recursive: true, force: true });

  for (const [ name, tokenFiles ] of Object.entries(files)) {
    const entries = Object.entries(tokenFiles);
    if (entries.length === 0) continue;

    const dir = path.join(baseDir, name);
    fs.mkdirSync(dir, { recursive: true });

    for (const [ fileName, content ] of entries) {
      fs.writeFileSync(path.join(dir, fileName), JSON.stringify(content, null, 2));
    }
  }
}
