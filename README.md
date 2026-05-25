# figma-tokens-import

Fetches variables from a Figma file, writes raw [W3C design token](https://design-tokens.github.io/community-group/format/) JSON files, and runs [Style Dictionary v5](https://styledictionary.com/). The generated files are written to disk — committing them is left to the caller.

Available as both a **GitHub Action** and an **npm package** (`@bonniernews/figma-tokens-import`).

## npm package

Install from the GitHub npm registry:

```bash
npm install @bonniernews/figma-tokens-import
```

Add the registry to your `.npmrc`:

```
@bonniernews:registry=https://npm.pkg.github.com
```

### Usage

```ts
import { syncFigmaTokens } from "@bonniernews/figma-tokens-import";

await syncFigmaTokens({
  figmaToken: process.env.FIGMA_TOKEN,
  figmaFileId: "your-file-id",
  tokensOutputPath: "/path/to/repo/design-tokens/tokens",
  jsonOutputPath: "/path/to/repo/design-tokens/json",
  excludedCollections: [ "Deprecated", "Internal" ],
});
```

`tokensOutputPath` and `jsonOutputPath` must be absolute paths when provided. The function writes the files and returns — committing is left to the caller.

Both output paths are optional, but at least one must be provided. Omitting `tokensOutputPath` skips writing W3C token files; omitting `jsonOutputPath` skips running Style Dictionary. When only `jsonOutputPath` is provided, W3C files are written to a temp directory so Style Dictionary can run, then removed.

### Options

| Option | Required | Default | Description |
|---|---|---|---|
| `figmaToken` | yes | — | Figma personal access token |
| `figmaFileId` | yes | — | The Figma file ID to fetch variables from |
| `tokensOutputPath` | no* | — | Absolute path where raw W3C token JSON files are written. Omit to skip. |
| `jsonOutputPath` | no* | — | Absolute path where Style Dictionary output is written. Omit to skip. |
| `excludedCollections` | no | `[]` | Collection names to skip (array or Set) |
| `sdConfigPath` | no | — | Absolute path to a Style Dictionary v5 config file. Takes full precedence over `sdTransforms`/`sdOutputFormat` |
| `sdTransforms` | no | `["attribute/cti", "name/kebab", "size/rem"]` | SD transforms to apply |
| `sdOutputFormat` | no | `"json/nested"` | SD output format |
| `cleanTokensOutput` | no | `false` | Delete `tokensOutputPath` before writing. |
| `cleanJsonOutput` | no | `false` | Delete `jsonOutputPath` before running Style Dictionary. |

\* At least one of `tokensOutputPath` or `jsonOutputPath` must be provided.

---

## GitHub Action

### Prerequisites

The calling workflow must:

1. Run `actions/checkout@v4` **before** this action so the workspace is populated
2. Store a Figma personal access token as a repository secret (e.g. `FIGMA_TOKEN`)

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `figma-token` | yes | — | Figma personal access token |
| `figma-file-id` | yes | — | The Figma file ID to fetch variables from |
| `tokens-output-path` | no* | — | Path where raw W3C token JSON files are written, mirroring the Figma collection hierarchy. Omit to skip. |
| `json-output-path` | no* | — | Path where Style Dictionary output is written. Omit to skip. |
| `excluded-collections` | no | `""` | Comma-separated list of Figma collection names to skip |
| `style-dictionary-config` | no | `""` | Path to a Style Dictionary v5 config file (relative to repo root). Takes full precedence — `sd-transforms` and `sd-output-format` are ignored when set |
| `sd-transforms` | no | `attribute/cti,name/kebab,size/rem` | Comma-separated SD transform names. Used only when `style-dictionary-config` is not provided |
| `sd-output-format` | no | `json/nested` | Style Dictionary output format. Used only when `style-dictionary-config` is not provided |
| `clean-tokens-output` | no | `false` | When `true`, delete `tokens-output-path` before writing |
| `clean-json-output` | no | `false` | When `true`, delete `json-output-path` before running Style Dictionary |

\* At least one of `tokens-output-path` or `json-output-path` must be provided. Omitting `tokens-output-path` skips writing W3C token files; omitting `json-output-path` skips running Style Dictionary.

### Usage

#### Minimal (default Style Dictionary config)

```yaml
name: Sync Figma Tokens
on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: figma-tokens-${{ github.ref }}
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: bonniernews/figma-tokens-import@v1
        with:
          figma-token: ${{ secrets.FIGMA_TOKEN }}
          figma-file-id: ${{ vars.FIGMA_FILE_ID }}
          tokens-output-path: design-tokens/tokens
          json-output-path: design-tokens/json
          excluded-collections: "Deprecated,Internal"
```

#### With a custom Style Dictionary config

```yaml
      - uses: bonniernews/figma-tokens-import@v1
        with:
          figma-token: ${{ secrets.FIGMA_TOKEN }}
          figma-file-id: ${{ vars.FIGMA_FILE_ID }}
          tokens-output-path: design-tokens/tokens
          json-output-path: design-tokens/json
          style-dictionary-config: style-dictionary.config.js
```

If the SD config uses custom transforms or formats installed as npm packages, add an install step before the action:

```yaml
      - run: npm ci
      - uses: bonniernews/figma-tokens-import@v1
        with:
          ...
```

---

## Releasing

1. Bump the version and create a git tag:
   ```bash
   npm version patch   # or minor / major
   ```
2. Push the tag:
   ```bash
   git push origin --tags
   ```

The release workflow publishes the package to npm and creates a GitHub release automatically when the tag is pushed.

---

## Running the example

```bash
cp example/env.example example/.env
# Edit example/.env and fill in FIGMA_TOKEN and FIGMA_FILE_ID
```

Then run:

```bash
npm run example
```

Output is written to `example/output/tokens/` (raw W3C token JSON) and `example/output/json/` (Style Dictionary output).

---

## Implementation notes

### Collection hierarchy

Figma's `LocalVariableCollection` includes an undocumented `parentVariableCollectionId` field that reliably encodes the parent-child collection hierarchy. This action uses it to nest collections correctly (e.g. `Colors/App/Brand/`) without any heuristic name matching. The resolved collection hierarchy is logged at debug level — set `ACTIONS_STEP_DEBUG=true` in your repo secrets to inspect it.

### Style Dictionary reference resolution

When using the default (inline) SD config, all token files are passed as `include` sources so Style Dictionary can resolve cross-collection references. Figma formula strings that are not valid SD references produce warnings rather than errors.

