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

Tags combine: `objections__Stop explaining the price #nocta.mov`.

Defaults you can change with environment variables on the n8n process (or edit the top of `watch-reel.sh`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `REEL_WATCH_ROOT` | `~/Reels` | work folder (renders in `videos/<name>/`) |
| `REEL_WATCH_DONE` | `~/Reels/done` | where finished MP4s are copied |
| `REEL_WATCH_CTA` | `Comment GHOST` | CTA text; set empty to disable |
| `REEL_WATCH_ARGS` | | extra flags for every edit, e.g. `--sfx --quality delivery` |

The script also pulls `REEL_*`, `ELEVENLABS_*` and `PRODUCER_*` exports from `~/.zshrc`, so the key you set for Terminal works here too.

## If n8n runs in Docker

A Docker n8n can't see `~/Reels` or run `reel` on the Mac. Two fixes:

- **Easiest:** run the watcher without n8n. `launchd` can call the same script on folder changes:
  ```bash
  cat > ~/Library/LaunchAgents/com.pingel.reel-watch.plist <<'PLIST'
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>com.pingel.reel-watch</string>
    <key>ProgramArguments</key><array>
      <string>/bin/bash</string><string>-c</string>
      <string>for f in "$HOME"/Reels/raw/*.{mov,mp4,m4v,MOV,MP4}; do [ -f "$f" ] || continue; [ -e "$HOME/Reels/videos/.seen/$(basename "$f")" ] && continue; mkdir -p "$HOME/Reels/videos/.seen"; "$HOME/Ai/reel-editor/scripts/watch-reel.sh" "$f" && touch "$HOME/Reels/videos/.seen/$(basename "$f")"; done</string>
    </array>
    <key>WatchPaths</key><array><string>/Users/gregpingel/Reels/raw</string></array>
    <key>RunAtLoad</key><true/>
  </dict></plist>
  PLIST
  launchctl load ~/Library/LaunchAgents/com.pingel.reel-watch.plist
  ```
- **Keep n8n in the loop:** replace the "reel edit" node with an SSH node to the Mac (`ssh gregpingel@localhost`) running the same `watch-reel.sh` command, and mount `~/Reels/raw` into the container for the trigger.

## From Google Drive instead of a local folder

Swap the trigger for a Google Drive Trigger on the "Greg Submagic Folder", add a Google Drive "Download" node, write the file to `~/Reels/raw` with a Write Binary File node, then continue into "reel edit". Everything downstream stays the same.
