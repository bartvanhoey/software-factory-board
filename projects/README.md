# Projects

The projects are managed in the web app (**Admin > Projects**). This folder is only a seed: when the web app starts and its
project table is empty, it imports every valid `projects/<name>.json` once. After that the files are ignored, so editing one
changes nothing. A file that does not validate is skipped, and the web app's log names it.

One JSON file per target repo. The filename must equal `name`: `projects/<name>.json`.
Run `npm run validate` to check the files before the first start.

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
| `limits.maxTurns` | no | `20` | agent turn cap for the build lane (1 to 100) |
| `limits.qaMaxTurns` | no | `20` | agent turn cap for the qa lane (1 to 100) |
| `limits.reviewMaxTurns` | no | `20` | agent turn cap for the review lane (1 to 100) |
| `limits.maxReworks` | no | `2` | how often the build lane reworks a card by itself after qa or review sent it back; `0` turns it off |
| `prompts.builder` / `qa` / `review` / `rework` | no | | prompt file path, relative to this repo's root |

Unknown keys are rejected. Clone paths are not set here: they come from the
per-machine `local.json` (see `local.example.json`).
