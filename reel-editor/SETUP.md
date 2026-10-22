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

Open Terminal, paste this line, and answer four questions. It takes about 10 minutes and ends by playing a test reel.

```
curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash
```

The four questions:

1. **Your look:** Greg Pingel's brand, plain white captions, or your own colors (two hex codes).
2. **Your ElevenLabs key:** paste it, or press Return to skip. It is typed hidden and saved only on your Mac.
3. **Drop folder:** yes to get a Reels folder on your Desktop that edits any clip you drop in.
4. **Codex:** yes to add generated b-roll and an Instagram carousel to every reel. It installs the Codex CLI and opens a browser to sign in with your ChatGPT account (it runs on your plan; no API key). Skipped when Codex is already set up.

If an Apple installer window pops up first, click Install, wait for it, and paste the line again. If Homebrew is missing, the installer adds it and asks for your Mac password once.

Run the same line again any time to update. It keeps your settings and only installs what is missing.

Run it in Terminal, not inside Claude Code: the questions need a keyboard, and without one it quietly takes the defaults (Greg's look, no key, drop folder on, Codex installed but not signed in). For a scripted install, pass the answers as options: `curl -fsSL <the URL above> | bash -s -- --yes --look custom --accent "#00AAFF" --text "#FFFFFF" --no-watch`.

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

If you said yes to the drop folder, it is already on. Desktop/Reels has three drop folders; the one you drop a clip into decides what you get back, and a Mac notification tells you when it is done (about 3 minutes for a 1-minute clip):

| Drop into | You get, in a new folder in Desktop/Reels |
| --- | --- |
| `Raw - Reel` | `2026-10-21 Reel 1`: the edited reel in the classic look (bold outlined captions, no cards) |
| `Raw - Reel with B-roll` | `2026-10-21 Reel 2 with B-roll`: the full look: graphic cards in the top third while you keep talking (numbers, checklists, quotes, key lines, steps), captions that light up word by word with a hand-drawn marker on the gold word, climax words that stamp in big as you say them, creator punch-ins, and 1-2 generated b-roll photos (graded, with a focus pull on the cut) in the gaps, plus the pictures (`B-roll 1.png`...) |
| `Raw - Carousel` | `2026-10-21 Carousel 1`: Instagram carousel slides made from the video, plus `carousel.txt` with the slide text |
| `Raw - Full YouTube Edit` | `2026-10-22 YouTube 1`: the whole video edited for YouTube (chapters with title cards, re-hooks, sparse cards and b-roll, punch-ins, a clean last 20 s) plus `description.txt` with the chapters, `titles.txt`, `captions.srt`, three thumbnail frames, `endscreen.json`. Captions are off by default; add `#captions` to the file name to burn them in |
| `Raw - Clips from Long Video` | `2026-10-22 Clips 1`: a podcast, live or training cut into up to 5 reels (`Clip 1 - <hook>.mp4` with cover, caption and words to check, `clips.txt` with the moments). Wide footage follows whoever is talking, cuts on the turn and splits the screen when two people trade lines |

Every folder also gets `caption.txt` (a caption, 3 hashtags and 3 hook ideas; when you did not write a hook in the file name, the first idea is the hook on the finished reel), reels get three covers, `Cover 1.png` to `Cover 3.png` (your best frame with a short bold title: outlined, on a dark bar, or with one word boxed; upload Cover 1 when you post, or whichever you like), a `Hook options` folder (the first 4 seconds rendered with hook ideas 2 and 3, so you can pick; drop the clip again as `clip__Your hook.mov` to use one) and `check these words.txt` when there is something to check. Wide or landscape clips are reframed to follow your face. A closing "thanks for watching" is cut so the reel ends on the point.

**Music:** put licensed tracks (mp3, m4a or wav, for example Epidemic Sound downloads) in **Desktop/Reels/Music**, named `<Mood> - Title - Artist.mp3`. The editor reads what you say and picks a track from the moods that fit, low under your voice (about 20 dB down), swelling a little in your pauses. Tracks named `Signature ...` come back more often; move tracks into the `Bench` folder to park them. `music.txt` in the reel folder names the track. Name a clip `clip #music:calm.mov` to force the track whose name has "calm", or `clip #nomusic.mov` for none. An empty Music folder means no music. Reels are named after their hook, and the numbers start again at 1 each day. To get two of them from one clip, drop it into both folders.

The Raw folders are shortcuts to `~/Reels/raw`, `~/Reels/raw-broll`, `~/Reels/raw-carousel`, `~/Reels/raw-long` and `~/Reels/raw-youtube`. macOS stops background jobs from reading Desktop folders, so leave them as shortcuts.

The filename is the brief:

| Filename | Result |
| --- | --- |
| `clip.mov` | Opening sentence as the hook |
| `clip__Stop explaining the price.mov` | Everything after the two underscores is the hook |
| `clip__Stop *explaining* the price.mov` | Asterisks pick the gold word |
| `clip #nozoom.mov` | No punch-in zooms |
| `clip #landscape.mov` | 16:9 for YouTube |
| `clip #low.mov` or `clip #top.mov` | Force the hook low or high (captions place themselves under your chin) |
| `clip #music:calm.mov` or `clip #nomusic.mov` | Use the Music track whose name has "calm", or no music |

`caption.txt` (a caption, 3 hashtags and 3 hook ideas based on what is winning for that topic right now) needs [Claude Code](https://claude.com/claude-code) and the Sandcastles connector on claude.ai; without them the folder has the reel and the note only. B-roll and the carousel need the Codex CLI signed in with a ChatGPT plan (the installer offers it; by hand: `npm install -g @openai/codex`, then `codex login`); without it, the b-roll folder gives a plain reel and the carousel folder gives nothing. Codex has usage limits: when it hits one, Codex is skipped for 20 minutes; a b-roll reel still arrives (with a note, and without b-roll) and a carousel leaves a note to drop it again. A failed clip gets a notification; rename the file to try it again. To turn the folder off: `~/Ai/reel-editor/scripts/install-watcher.sh --uninstall`.

## Troubleshooting

Run `reel doctor` first; most problems show up there.

| What you see | Why | Fix |
| --- | --- | --- |
| The installer stops after an Apple window opens | Apple's command line tools were missing | Click Install, wait for it to finish, paste the install line again |
| `reel: command not found` | The Terminal window was open before the install | Open a new Terminal window |
| doctor says `faster-whisper MISSING`, or `unexpected keyword argument 'metadata_errors'` | The Whisper setup is missing or was upgraded past what it supports | Run the install line again |
| `ElevenLabs Scribe failed ... using local Whisper` | Key missing, wrong, or out of credits | Check the key in `~/.zshrc` and your ElevenLabs balance; the reel still finishes with Whisper |
| Drop folder does nothing, no notification | The drop folder was moved onto the Desktop as a real folder | Move your clips out, delete that Raw folder, then run the install line again to make the shortcuts |
| "Reel failed" notification | Something broke mid-edit | Read the end of `~/Reels/watch.log`, then rename the clip to retry |
| Hook sits on your face | No face found (turned away, very dark) | Add `--hook-position 0.08` (top) or `0.4` (chest), or `#top` / `#low` in the filename |
| A caption word is wrong | Both engines misheard it the same way | Fix the `text` in `plan.json`, run `reel build`, and add the word to `corrections` in `~/.reel/dictionary.json` |

To update later, paste the install line again.
