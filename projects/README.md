# Projects

One JSON file per target repo. The filename must equal `name`: `projects/<name>.json`.
To add a project, drop in a new file and run `npm run validate`.

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `name` | yes | | lowercase slug, must match the filename |
| `repo` | yes | | `owner/name` on GitHub |
| `defaultBranch` | no | `main` | |
| `enabled` | no | `true` | `false` pauses all lanes |
| `stack` | no | `other` | `dotnet`, `node`, `python`, `other` |
| `commands.build` | no | | run when no `test` command exists |
| `commands.test` | no | | omit for projects without tests |
| `lanes.build` / `qa` / `review` | no | `true` | disable a lane per project |
| `limits.maxTurns` | no | `20` | agent turn cap |
| `prompts.builder` / `qa` / `review` | no | | prompt file path, relative to this repo's root |

Unknown keys are rejected. Clone paths are not set here: they come from the
per-machine `local.json` (see `local.example.json`).
