# n8n: watch a folder, edit every clip

Drop a raw clip into `~/Reels/raw` on the Mac Mini and a finished reel shows up in `~/Reels/done` a minute later, with a Mac notification (and a #pingel-hq post once you enable the Slack node).

## Import

1. n8n → Workflows → Import from File → `reel-editor/n8n/reel-watch-folder.json`.
2. Open the trigger node and check the path is `/Users/gregpingel/Reels/raw` (create the folder: `mkdir -p ~/Reels/raw ~/Reels/done`).
3. Open the "reel edit" node and check the script path is `/Users/gregpingel/Ai/reel-editor/scripts/watch-reel.sh`.
4. Optional: open "Post to #pingel-hq", pick your Slack credential, and enable the node.
5. Activate the workflow.

Test: `cp some-clip.mov ~/Reels/raw/`. Watch `~/Reels/watch.log`.

## Filename is the brief

The watcher reads the filename so you can steer an edit from your phone without opening anything:

| Filename | What happens |
| --- | --- |
| `clip.mov` | default edit, auto hook from the opening line, `Comment GHOST` CTA |
| `clip__You don't have a sales problem.mov` | everything after `__` becomes the hook title |
| `clip #nocta.mov` | no CTA |
| `clip #nozoom.mov` | no magic zooms |
| `clip #landscape.mov` | 16:9 canvas for YouTube |
| `clip #low.mov` | hook at chest height instead of 22% from the top (wide shots) |

Tags combine: `objections__Stop explaining the price #nocta.mov`.

Defaults you can change with environment variables on the n8n process (or edit the top of `watch-reel.sh`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `REEL_WATCH_ROOT` | `~/Reels` | work folder (renders in `videos/<name>/`) |
| `REEL_WATCH_DONE` | `~/Reels/done` | where finished MP4s are copied (named after the hook when there is one); on the Mini this is `~/Desktop/Reels` |
| `REEL_WATCH_CTA` | `Comment GHOST` | CTA text; set empty to disable |
| `REEL_WATCH_ARGS` | | extra flags for every edit, e.g. `--sfx --quality delivery` |

The script also pulls `REEL_*`, `ELEVENLABS_*` and `PRODUCER_*` exports from `~/.zshrc`, so the key you set for Terminal works here too.

## Without n8n (the Mini today)

n8n is not installed on the Mini, and a Docker n8n can't see `~/Reels` or run `reel` on the Mac anyway. A launchd agent does the same job with no n8n:

```bash
~/Ai/reel-editor/scripts/install-watcher.sh             # turn it on
~/Ai/reel-editor/scripts/install-watcher.sh --dry-run   # show and validate the agent, change nothing
~/Ai/reel-editor/scripts/install-watcher.sh --uninstall # turn it off
```

The agent runs `scripts/watch-folder.sh` whenever `~/Reels/raw` changes.

**Keep the drop folder out of the Desktop, Documents and Downloads.** macOS privacy protection stops background jobs from listing those folders: the watcher fires, sees an empty folder, and exits cleanly, so nothing happens and nothing errors. To drop from the Desktop, make a shortcut to the real folder:

```bash
ln -s ~/Reels/raw ~/Desktop/Reels/Raw
```

Writing finished reels to the Desktop (`REEL_WATCH_DONE=~/Desktop/Reels`) works fine. Granting /bin/bash Full Disk Access would also work, but it opens far more than this needs. That script edits each new clip once through `watch-reel.sh`, leaves a `.done` or `.failed` marker in `~/Reels/videos/.seen`, and keeps scanning until nothing new is left. Rename a failed clip to retry it. Its own output goes to `~/Reels/watch-launchd.log`; each edit still logs to `~/Reels/watch.log`.

To keep n8n in the loop instead, run n8n natively on the Mac (`npx n8n`), or replace the "reel edit" node with an SSH node to the Mac running the same `watch-reel.sh` command and mount `~/Reels/raw` into the container for the trigger.

## From Google Drive instead of a local folder

Swap the trigger for a Google Drive Trigger on the "Greg Submagic Folder", add a Google Drive "Download" node, write the file to `~/Reels/raw` with a Write Binary File node, then continue into "reel edit". Everything downstream stays the same.
