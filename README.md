# figma-tokens-action

A reusable GitHub Action that fetches variables from a Figma file, writes raw [W3C design token](https://design-tokens.github.io/community-group/format/) JSON files, runs [Style Dictionary v5](https://styledictionary.com/), and commits the output back to the calling repo.

## Prerequisites

The calling workflow must:

1. Run `actions/checkout@v4` **before** this action (the default `persist-credentials: true` is required for the git push)
2. Grant `permissions: contents: write`
3. Store a Figma personal access token as a repository secret (e.g. `FIGMA_TOKEN`)
4. Use a `concurrency:` group to prevent parallel runs on the same branch

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `figma-token` | yes | — | Figma personal access token |
| `figma-file-id` | yes | — | The Figma file ID to fetch variables from |
| `tokens-output-path` | no | `design-tokens/tokens` | Path where raw W3C token JSON files are written, mirroring the Figma collection hierarchy |
| `json-output-path` | no | `design-tokens/json` | Path where Style Dictionary output is written |
| `excluded-collections` | no | `""` | Comma-separated list of Figma collection names to skip |
| `style-dictionary-config` | no | `""` | Path to a Style Dictionary v5 config file (relative to repo root). Takes full precedence — `sd-transforms` and `sd-output-format` are ignored when set |
| `sd-transforms` | no | `attribute/cti,name/kebab,size/rem` | Comma-separated SD transform names. Used only when `style-dictionary-config` is not provided |
| `sd-output-format` | no | `json/nested` | Style Dictionary output format. Used only when `style-dictionary-config` is not provided |
| `commit-message` | no | `chore: update design tokens from Figma` | Commit message for the token update commit |
| `git-user-name` | no | `github-actions[bot]` | Git user name for the commit |
| `git-user-email` | no | `github-actions[bot]@users.noreply.github.com` | Git user email for the commit |

## Usage

### Minimal (default Style Dictionary config)

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

      - uses: bonniernews/figma-tokens-action@v1
        with:
          figma-token: ${{ secrets.FIGMA_TOKEN }}
          figma-file-id: ${{ vars.FIGMA_FILE_ID }}
          tokens-output-path: design-tokens/tokens
          json-output-path: design-tokens/json
          excluded-collections: "Deprecated,Internal"
```

### With a custom Style Dictionary config

```yaml
      - uses: bonniernews/figma-tokens-action@v1
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
      - uses: bonniernews/figma-tokens-action@v1
        with:
          ...
```

## Implementation notes

### Collection hierarchy

Figma's `LocalVariableCollection` includes an undocumented `parentVariableCollectionId` field that reliably encodes the parent-child collection hierarchy. This action uses it to nest collections correctly (e.g. `Colors/App/Brand/`) without any heuristic name matching. The resolved collection hierarchy is logged at debug level — set `ACTIONS_STEP_DEBUG=true` in your repo secrets to inspect it.

### Style Dictionary reference resolution

When using the default (inline) SD config, all token files are passed as `include` sources so Style Dictionary can resolve cross-collection references. Figma formula strings that are not valid SD references produce warnings rather than errors.

### Preventing empty commits

The action checks `git diff --staged` before committing. If no token files changed, the commit is skipped and the action exits successfully.
