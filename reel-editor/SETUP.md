# Reel Editor Setup Guide

Last checked on a clean setup: 21 Oct 2026.

Reel Editor turns a raw talking-head clip into a finished vertical reel on your own Mac: captions, cuts, a hook title placed around your face, and a check on every word. Setup takes about 30 minutes; a 1-minute clip then takes about 3 minutes.

## What you need

A Mac with Apple Silicon and about 4 GB of free disk is the only hard requirement; everything else is free to install.

| Item | Why | Notes |
| --- | --- | --- |
| Mac with Apple Silicon (M1 or newer) | Renders on the Mac's graphics chip; finds faces with Apple Vision | An M4 Pro renders a 1-minute reel in about 70 s |
| macOS command line tools | Swift (face finding) and git | `xcode-select --install`, one time |
| Homebrew | Installs ffmpeg, Node and Python | [brew.sh](https://brew.sh) |
| About 4 GB free disk | Whisper large-v3-turbo model 1.5 GB, render browser 0.85 GB, the rest for your reels | Downloaded once on first use |
| ElevenLabs account and API key | Scribe, the main transcription engine; optional sound effects | Without a key it uses Whisper alone, still accurate, with no second opinion. Key permissions: Speech to Text, Sound Effects, Text to Speech |
| Claude Code (optional) | Can run this whole setup for you, and edit reels by chat | [claude.com/claude-code](https://claude.com/claude-code) |

## Fastest way: let Claude Code do it

Open Claude Code in your home folder, paste the prompt below, and approve the steps it asks about. It installs everything, proves it with a test reel, and tells you what is left. The only thing it cannot do for you is paste your ElevenLabs key; it will ask.

```
Set up the reel editor on this Mac from https://github.com/gpingelbiz/Ai (folder reel-editor).
1. Install Homebrew packages: ffmpeg, node, python. Run xcode-select --install if Swift is missing.
2. Clone the repo into ~/Ai. In ~/Ai/reel-editor run npm install, then npm link.
3. Make a Python venv at ~/.reel-venv and install: faster-whisper "av<17"
   (av 19 breaks faster-whisper 1.2.1 with "unexpected keyword argument metadata_errors").
4. Run npx hyperframes browser ensure in ~/Ai/reel-editor.
5. Add to ~/.zshrc:
   export REEL_PYTHON="$HOME/.reel-venv/bin/python"
   export PRODUCER_BROWSER_GPU_MODE=hardware
   Then ask me for my ElevenLabs API key and add export ELEVENLABS_API_KEY="..." without printing it.
6. Run reel doctor and fix anything it flags.
7. Prove it: make a 24 s test clip with ffmpeg testsrc2 at 1080x1920 with a sine audio track, run
   reel edit test.mov --transcript ~/Ai/reel-editor/examples/sample-words.json --hook "It works"
   and show me two frames of the render.
Read reel-editor/SKILL.md and README.md before starting.
```

After that, start Claude Code in `~/Ai` and say: "Read reel-editor/SKILL.md and README.md. You are the reel editor from now on." Then drop a clip in the chat and ask for a reel.

## Install by hand

Eight steps in Terminal, about 30 minutes with downloads.

1. Install Apple's command line tools (skip if already there):

   ```
   xcode-select --install
   ```

2. Install the tools from Homebrew:

   ```
   brew install ffmpeg node python
   ```

3. Get the code and link the `reel` command:

   ```
   git clone https://github.com/gpingelbiz/Ai.git ~/Ai
   cd ~/Ai/reel-editor && npm install && npm link
   ```

4. Install Whisper in its own Python environment. Keep the `av<17` pin: the newest PyAV breaks transcription with "unexpected keyword argument metadata_errors".

   ```
   python3 -m venv ~/.reel-venv
   ~/.reel-venv/bin/pip install faster-whisper "av<17"
   ```

5. Download the browser that renders the reels:

   ```
   cd ~/Ai/reel-editor && npx hyperframes browser ensure
   ```

6. Add these lines to `~/.zshrc` (open it with `open -e ~/.zshrc`), with your own ElevenLabs key:

   ```
   export REEL_PYTHON="$HOME/.reel-venv/bin/python"
   export PRODUCER_BROWSER_GPU_MODE=hardware
   export ELEVENLABS_API_KEY="your-key-here"
   ```

7. Open a new Terminal window and check everything. Every line should say ok or set:

   ```
   cd ~/Ai/reel-editor && reel doctor
   ```

8. Make a test reel from a generated clip (no camera needed):

   ```
   mkdir -p ~/Reels && cd ~/Reels
   ffmpeg -f lavfi -i testsrc2=size=1080x1920:rate=30 -f lavfi -i sine=frequency=440 -t 24 -pix_fmt yuv420p -shortest test.mov
   reel edit test.mov --transcript ~/Ai/reel-editor/examples/sample-words.json --hook "It works"
   ```

   The last line printed is the path to the finished MP4. Your first real clip downloads the Whisper model once, about 1.5 GB, so it takes a few extra minutes.

## Make it yours

Out of the box every reel uses Greg Pingel's brand, so give yours its own preset before you post anything. It takes about 10 minutes.

1. Copy the brand preset and name it after yourself:

   ```
   cd ~/Ai/reel-editor && cp presets/pingel-brand.json presets/my-brand.json
   ```

2. In `presets/my-brand.json`, set `colors` to your brand: `text` (caption words), `accent` (the gold keyword and hook phrase), `stroke` (outline around words) and `bg` (dark backing), all as hex codes.
3. Open `dictionary.json` and replace Greg's words with yours:
   - `terms`: your program and framework names, always highlighted and spelled right by Whisper
   - `phrases`: everyday phrases you want highlighted (these are not sent to Whisper)
   - `powerWords`: single words worth highlighting when a line has nothing else
   - `corrections`: fixes for words Whisper keeps mishearing, such as `{"from": "ghost p and l", "to": "Ghost P&L"}`
4. Use your preset on every edit with `--preset my-brand`. For plain white subtitles with no brand styling, use `--preset clean`.
5. The call-to-action pop-up is off unless you ask for it: `--cta "Comment YOURWORD"` adds it for the last 3 seconds.

## Your first reel

One command edits a clip start to finish. Write the hook yourself (4 to 8 words); without one, your opening sentence becomes the hook.

```
cd ~/Reels
reel edit my-clip.mov --preset my-brand --hook "The *10 minutes* after a bad number"
```

The words in `*asterisks*` become the gold phrase. Leave them out and it picks one for you.

What happens, in order:

1. ElevenLabs Scribe writes down every word with its timing; Whisper on your Mac gives a second opinion.
2. Pauses, ums, stutters and restarted sentences are cut, but only where the audio is truly silent.
3. Captions go in, 3 words a line, with a highlighted keyword.
4. Apple Vision finds your face, and the hook goes above your head or below your chin.
5. The reel renders to `~/Reels/videos/my-clip/renders/my-clip.mp4`.

Check the summary it prints. If it says `review: 2 spots to check`, open `videos/my-clip/review.txt`: each spot shows what the caption says, what the other engine heard, and the time in the finished reel.

To fix a caption, edit its `text` in `videos/my-clip/plan.json` and run `reel build videos/my-clip`. That re-renders in about a minute and skips transcription.

| Flag | What it does |
| --- | --- |
| `--hook "..."` | Your hook title for the first 3 seconds |
| `--hook-position 0.4` | Force the hook height (0 = top) instead of placing it around your face |
| `--cta "Comment WORD"` | Call-to-action pop-up in the last 3 seconds |
| `--sfx` | ElevenLabs whoosh on zoom-ins and a pop on the hook |
| `--no-zooms` | No punch-in zooms |
| `--silence slow` | Cut fewer pauses (`medium`, `fast` default) |
| `--canvas landscape` | 16:9 for YouTube |

## Drop folder (optional)

Turn this on and you never type a command: drop a clip into a folder, and a finished reel shows up next to it with a Mac notification.

1. Turn it on, with finished reels going to a Reels folder on your Desktop:

   ```
   mkdir -p ~/Desktop/Reels ~/Reels/raw
   ln -s ~/Reels/raw ~/Desktop/Reels/Raw
   REEL_WATCH_RAW=~/Reels/raw REEL_WATCH_DONE=~/Desktop/Reels ~/Ai/reel-editor/scripts/install-watcher.sh
   ```

2. Add two lines to `~/.zshrc`, or the drop folder uses Greg's brand and adds his "Comment GHOST": `export REEL_WATCH_ARGS="--preset my-brand"` and `export REEL_WATCH_CTA=""` (or `"Comment YOURWORD"` for a call-to-action).
3. Drop a clip into Desktop/Reels/Raw. A 1-minute clip comes out in about 3 minutes.

Keep the real drop folder in `~/Reels/raw` and use the Raw shortcut on the Desktop. macOS stops background jobs from reading Desktop folders, so a real folder there fires but looks empty.

The filename is the brief:

| Filename | Result |
| --- | --- |
| `clip.mov` | Opening sentence as the hook |
| `clip__Stop explaining the price.mov` | Everything after the two underscores is the hook |
| `clip__Stop *explaining* the price.mov` | Asterisks pick the gold word |
| `clip #nozoom.mov` | No punch-in zooms |
| `clip #landscape.mov` | 16:9 for YouTube |
| `clip #low.mov` or `clip #top.mov` | Force the hook low or high |

When a reel has doubtful words, a `check these words.txt` note lands beside it. A failed clip gets a notification; rename the file to try it again. To turn the folder off: `~/Ai/reel-editor/scripts/install-watcher.sh --uninstall`.

## Troubleshooting

Run `reel doctor` first; most problems show up there.

| What you see | Why | Fix |
| --- | --- | --- |
| `TypeError: open() got an unexpected keyword argument 'metadata_errors'` | PyAV 19 is installed; faster-whisper 1.2.1 needs an older one | `~/.reel-venv/bin/pip install "av<17"` |
| doctor says `faster-whisper MISSING` | `REEL_PYTHON` is not set in this Terminal window | Check step 6, then open a new Terminal window |
| Hook shows but no captions (iPhone video) | An old copy of the code; HDR video hid the captions | `cd ~/Ai && git pull` |
| `ElevenLabs Scribe failed ... using local Whisper` | Key missing, wrong, or out of credits | Check the key in `~/.zshrc` and your ElevenLabs balance; the reel still finishes with Whisper |
| Drop folder does nothing, no notification | The real drop folder is on the Desktop | Use `~/Reels/raw` plus the Desktop shortcut (Drop folder, step 1) |
| "Reel failed" notification | Something broke mid-edit | Read the end of `~/Reels/watch.log`, then rename the clip to retry |
| Hook sits on your face | No face found (turned away, very dark) | Add `--hook-position 0.08` (top) or `0.4` (chest), or `#top` / `#low` in the filename |
| A caption word is wrong | Both engines misheard it the same way | Fix the `text` in `plan.json`, run `reel build`, and add the word to `corrections` in `dictionary.json` |

To update later: `cd ~/Ai && git pull`, then `reel doctor`.
