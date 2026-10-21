# Reel Editor Setup Guide

Last checked on a clean setup: 21 Oct 2026.

Reel Editor turns a raw talking-head clip into a finished vertical reel on your own Mac: captions, cuts, a hook title placed around your face, and a check on every word. Setup is one command and about 10 minutes; a 1-minute clip then takes about 3 minutes.

## What you need

A Mac with Apple Silicon, about 4 GB of free disk, and an internet connection. The installer adds everything else.

| Item | Why | Notes |
| --- | --- | --- |
| Mac with Apple Silicon (M1 or newer) | Renders on the Mac's graphics chip; finds faces with Apple Vision | An M4 Pro renders a 1-minute reel in about 70 s |
| About 4 GB free disk | Whisper model 1.5 GB, render browser 0.85 GB, the rest for your reels | Downloaded once |
| ElevenLabs API key (optional) | Scribe, the most accurate transcription, plus a second opinion from Whisper | From elevenlabs.io, Developers, API Keys. Permissions: Speech to Text, Sound Effects, Text to Speech. Without it, Whisper alone |

## Install: one command

Open Terminal, paste this line, and answer three questions. It takes about 10 minutes and ends by playing a test reel.

```
curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash
```

The three questions:

1. **Your look:** Greg Pingel's brand, plain white captions, or your own colors (two hex codes).
2. **Your ElevenLabs key:** paste it, or press Return to skip. It is typed hidden and saved only on your Mac.
3. **Drop folder:** yes to get a Reels folder on your Desktop that edits any clip you drop in.

If an Apple installer window pops up first, click Install, wait for it, and paste the line again. If Homebrew is missing, the installer adds it and asks for your Mac password once.

Run the same line again any time to update. It keeps your settings and only installs what is missing.

Run it in Terminal, not inside Claude Code: the questions need a keyboard, and without one it quietly takes the defaults (Greg's look, no key, drop folder on). For a scripted install, pass the answers as options: `curl -fsSL <the URL above> | bash -s -- --yes --look custom --accent "#00AAFF" --text "#FFFFFF" --no-watch`.

## Make it yours

The installer sets your look. Two things are still yours to fill in.

1. **Your words.** Open `~/.reel/dictionary.json` and add your program and framework names to `terms`: they are always highlighted and Whisper spells them right. Add fixes for words it keeps mishearing to `corrections`, such as `{"from": "ghost p and l", "to": "Ghost P&L"}`. Everyday phrases to highlight go in `phrases`.
2. **A call-to-action, if you want one.** `--cta "Comment YOURWORD"` adds a pop-up for the last 3 seconds of a reel. For drop-folder reels, put the same text in `REEL_WATCH_CTA` in `~/.zshrc`.

To change your look later, run the install line again and pick another option, or open `~/.reel/my-brand.json` and edit the `colors` hex codes.

## Your first reel

One command edits a clip start to finish. Write the hook yourself (4 to 8 words); without one, your opening sentence becomes the hook.

```
cd ~/Reels
reel edit my-clip.mov --hook "The *10 minutes* after a bad number"
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
| `--preset clean` | Plain white captions for this one reel |

## Drop folder (optional)

If you said yes to the drop folder, it is already on: drop a clip into **Desktop/Reels/Raw**, and the finished reel appears in **Desktop/Reels** with a Mac notification. A 1-minute clip takes about 3 minutes.

Raw is a shortcut to `~/Reels/raw`. macOS stops background jobs from reading Desktop folders, so leave it as a shortcut.

The filename is the brief:

| Filename | Result |
| --- | --- |
| `clip.mov` | Opening sentence as the hook |
| `clip__Stop explaining the price.mov` | Everything after the two underscores is the hook |
| `clip__Stop *explaining* the price.mov` | Asterisks pick the gold word |
| `clip #nozoom.mov` | No punch-in zooms |
| `clip #landscape.mov` | 16:9 for YouTube |
| `clip #low.mov` or `clip #top.mov` | Force the hook low or high |

When a reel has doubtful words, a `check these words.txt` note lands beside it. If you use [Claude Code](https://claude.com/claude-code) and have the Sandcastles connector on claude.ai, a `caption.txt` lands beside it too: a caption, 3 hashtags and 3 hook ideas based on what is winning for that topic right now. A failed clip gets a notification; rename the file to try it again. To turn the folder off: `~/Ai/reel-editor/scripts/install-watcher.sh --uninstall`.

## Troubleshooting

Run `reel doctor` first; most problems show up there.

| What you see | Why | Fix |
| --- | --- | --- |
| The installer stops after an Apple window opens | Apple's command line tools were missing | Click Install, wait for it to finish, paste the install line again |
| `reel: command not found` | The Terminal window was open before the install | Open a new Terminal window |
| doctor says `faster-whisper MISSING`, or `unexpected keyword argument 'metadata_errors'` | The Whisper setup is missing or was upgraded past what it supports | Run the install line again |
| `ElevenLabs Scribe failed ... using local Whisper` | Key missing, wrong, or out of credits | Check the key in `~/.zshrc` and your ElevenLabs balance; the reel still finishes with Whisper |
| Drop folder does nothing, no notification | The drop folder was moved onto the Desktop as a real folder | Move your clips out, delete that Raw folder, then run the install line again to make the shortcut |
| "Reel failed" notification | Something broke mid-edit | Read the end of `~/Reels/watch.log`, then rename the clip to retry |
| Hook sits on your face | No face found (turned away, very dark) | Add `--hook-position 0.08` (top) or `0.4` (chest), or `#top` / `#low` in the filename |
| A caption word is wrong | Both engines misheard it the same way | Fix the `text` in `plan.json`, run `reel build`, and add the word to `corrections` in `~/.reel/dictionary.json` |

To update later, paste the install line again.
