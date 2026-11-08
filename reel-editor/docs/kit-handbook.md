# Kit handbook: make, send and install a client kit

For whoever sets up a client (Greg, a team member or a VA). A client kit gives the client the same tested editor that runs on Greg's Macs, in their own brand, installed in their own home folder: no password, no Homebrew, no Apple developer tools.

## What the client needs
- An Apple Silicon Mac (M1 or newer) on macOS 14 or newer, at least 20 GB free (the health check warns under 15 GB), and a good connection for the first install (about 2 GB of downloads).
- Their own accounts, made before or during setup: Claude (Pro or Max), Metricool with Instagram connected (for posting), and optionally ChatGPT (B-roll stills and carousels), ElevenLabs, Runway, Pixabay, Pexels. The kit's "Sign up here" folder has a link for each.
- Their own brand file and their own music. Kits never carry Greg's brand, music, presets as a look, keys or accounts.

## 1. Cut a tested release (on Greg's MacBook)
A release is one exact build of the editor and its tools. Every kit installs one release, so two clients installing a week apart get the same thing.

```bash
cd ~/Ai/reel-editor
npm run release -- build --id 2026.11.09.1
```

It refuses to build unless the code is committed, every test passes and all six golden frames match. It bundles the pinned tools list (`runtime/runtime.json`), the prebuilt Mac helpers and the render browser, and prints the file and its checksum. Release numbers go up and are never reused.

Publishing puts it on GitHub (public, like the code), where kits download it:

```bash
node scripts/release.mjs publish 2026.11.09.1 --yes
```

It shows exactly what it will publish first. Only Greg says when to publish.

## 2. Build the client's kit
```bash
node scripts/brand-kit.mjs ~/Reels/client-brands/<client>.json --release dist/release/2026.11.09.1/release.json --out ~/Desktop/Reels/Clients/"Client kits"/<Client>
```
Add `--studio <their brand-guide.md>` for a full Reels kit (reels plus Claude-made carousels and posts that post through Metricool). To rebuild every client at once from one release: `node scripts/release.mjs kits 2026.11.09.1 --clients ~/Reels/client-brands/kits.json`.

The kit folder holds the installer, `install.sh`, `release.json`, two setup scripts, the client's Brand folder, Start Here, Setup Guide, the "Sign up here" links and a send-out message next to the zip.

## 3. Send it
Use AirDrop, or a Google Drive or Dropbox link. Not iMessage (attachments fail) and not a Gmail attachment (Gmail refuses zips with scripts). Paste the send-out message from next to the zip.

## 4. Install it (on the client's Mac, about 20 to 40 minutes the first time)
1. Unzip the kit. Keep the whole folder together.
2. Open Terminal (Applications, Utilities). Type `bash` and a space, drag the Install file from the kit folder into the window, press Return. This never needs a security setting. Double-clicking the Install file also works when macOS allows it; if it says it cannot be opened, use the Terminal steps, never System Settings.
3. Answer the few questions (keys can be skipped and added later).
4. Wait for "Editing ready (release ...)". The installer has transcribed and rendered a test reel offline, and opens it.
5. Reels kits: a setup page opens in the browser for Claude, Metricool, posting times and the two Claude routines. It saves after every step; `reel setup` in Terminal reopens it where it stopped. Posting counts as ready only after both routines have done one test run that posts nothing.

If anything stops, the message says what to do and `~/.reel/install.log` has the details. Running the installer again picks up where it stopped and never redoes finished steps.

## After the install
- `reel doctor` shows the release, the tools and the accounts. `Desktop/Reels/STATUS.txt` says, in one line, whether everything is fine or the one thing to do.
- Weekly, the Mac moves to the next published release on its own, only when nothing is editing, and rolls back if the new one fails its checks.
- A post whose outcome is unclear is held, never sent twice: the client checks Metricool, then `reel studio publish release <reel> --posted` or `--not-posted`.

## Greg's own Macs
They keep the git checkout, presets and jobs. `bash scripts/adopt-runtime.sh` gives them the same pinned tools as the kits (undo with `--undo`).
