# Opus Dropbox

Unedited videos dropped in a Dropbox folder go to [Opus Clip](https://www.opus.pro/api), and the finished clips come back into another Dropbox folder by themselves. It runs on the client's own Mac and uses the client's own Opus and Dropbox accounts. Nothing in this folder is specific to one client.

```
<drop folder>/Podcast Ep 4.mp4                 the client drops a video (phone, Mac, anywhere Dropbox runs)
      │  every 5 minutes: a public Dropbox link goes to Opus (the video never passes through the Mac)
      ▼
Opus Clip finds the moments, reframes, captions with the brand template
      │  Dropbox fetches each finished clip from Opus itself
      ▼
<finished folder>/Podcast Ep 4/Clip 1 - <title>.mp4
                              Clip 1 - caption.txt   (Opus's title, description, hashtags)
<drop folder>/Done/Podcast Ep 4.mp4            the original, filed
<drop folder>/Needs a look/…                   a video that failed, plus "<name> - what happened.txt"
```

## What it costs and needs

- **Opus**: a plan with API access (Pro, Max or Business). Every project bills at least 10 credits (about 10 minutes of video), however short the video. Pro and Max run up to 4 projects at once and include 15 hours of API video a month. The tool keeps 3 in Opus at once (`maxInFlight`).
- **Dropbox**: any account, personal or team. Team accounts that block public links get a 4-hour download link instead, which is all Opus needs to import the video.
- **Mac**: any Mac. The installer gets its own Node from nodejs.org, so it needs no password and no Homebrew. It runs while the Mac is awake. A closed laptop catches up when it opens.

## The Dropbox app (once, for every client)

The kit signs in to the client's Dropbox through a Dropbox app that you own. The client clicks Allow on their own account, and only the app's public key goes in the kit.

1. Go to https://www.dropbox.com/developers/apps, click **Create app**, then pick **Scoped access** and **Full Dropbox**. The name has to be unique and can't contain "Dropbox".
2. **Permissions** tab: tick `files.metadata.read`, `files.content.read`, `files.content.write`, `sharing.read` and `sharing.write`, then **Submit**. Do this before anyone signs in, because scopes are granted at sign-in.
3. **Settings** tab, OAuth 2: add the redirect URI `http://localhost:53682/dropbox`. Leave "Allow public clients (Implicit Grant & PKCE)" on Allow.
4. Copy the **App key**. Never use the secret.

5. **Settings** tab, Development users: click **Enable additional users**. Until you do, only the app's owner can sign in.

A new app is in "development" status, and with additional users enabled up to 500 accounts can sign in to it. Each client first sees a "Before you connect this app..." warning, because the app has few users. They click Continue, then Allow. Apply for production in the same console when there are many clients.

Greg's app is **Pingel Consulting**, made 2026-11-04 with additional users on. Reuse it for every client. Its key is on the app's Settings page, and it goes only into kits, not this repo.

## Make a client's kit

```bash
opus-dropbox/scripts/make-kit.sh --name "Client Name" --app-key <app key> --out ~/Desktop
```

This builds `Client Name Opus Dropbox Kit.zip` with `Install Opus Dropbox.command`, `Read me first.txt` and the tool. On the client's Mac, unzip it and double-click the installer (the first time, right-click it and pick Open). The installer:

1. asks for the Opus API key and checks it,
2. asks which brand template and clip length to use,
3. opens Dropbox so they can click Allow,
4. asks which folder videos are dropped in and which folder the clips go to (it can create one),
5. lists any videos already in the drop folder and leaves them alone unless you say to send them (each one costs credits),
6. starts the background job (`com.pingel.opus-dropbox`, every 5 minutes), runs `check`, and puts **Opus Dropbox Status** on the Desktop.

Running the installer again updates the tool and keeps every answer.

## Commands

The installer puts the tool in `~/Library/Application Support/Opus Dropbox/app`, with its own Node in `…/node/bin/node`. From that folder:

| Command | What it does |
| --- | --- |
| `node bin/opus-dropbox.mjs status` | what's waiting, in Opus, done or failed, and the last run (same as the Desktop shortcut) |
| `node bin/opus-dropbox.mjs check` | tests the Opus key, the Dropbox sign-in, both folders and the background job. Changes nothing |
| `node bin/opus-dropbox.mjs run` | one pass now |
| `node bin/opus-dropbox.mjs send "<file name>"` | sends a video that setup left alone |
| `node bin/opus-dropbox.mjs setup` | the setup questions again |
| `node bin/opus-dropbox.mjs stop` / `start` | pause or resume the background job |

The files live in `~/Library/Application Support/Opus Dropbox`: `config.json` (the keys, mode 600), `state.json`, `run.log` (one JSON line per event) and `launchd.log`.

## The shared board

`opus-dropbox board install` readies a read-only page and copies a prompt. Pasted once in the Claude app's Code tab, it publishes the page as an artifact on that Claude account and points the `opus-watch` routine at it, so the board updates hourly while the Mac is on and the app is open. `opus-dropbox snapshot` writes what the board gets: named fields only, never a key, a sign-in or a share link. Settings and re-cuts stay on the local page.

## Rules it keeps

- **A video is never sent to Opus twice by accident.** If a send might have gone through (the run died mid-send, or Opus gave no clear answer), the video goes to Needs a look with a note telling the client to check Opus first.
- **A blocked Opus account is not a failed video.** A bad key, no API on the plan, a used-up month or a rate limit keeps the videos waiting, with one Mac notification every 12 hours at most.
- **Interrupted deliveries resume.** Each clip is written down once it's saved. Clip numbers never change, and a clip that's already saved isn't fetched again (Dropbox's save-from-link adds " (1)" copies rather than replacing).
- **A project stuck in Opus for 24 hours** (`stuckHours`) gets one notification and keeps being checked.

Options in `config.json`: `maxInFlight` (3), `stuckHours` (24), `notify` (true), and `opus.project`, which is sent with every project (`brandTemplateId`, `curationPref` such as `clipDurations`, `genre`, `topicKeywords`, `importPref.sourceLang`). See the [create project reference](https://help.opus.pro/api-reference/endpoints/create-project).

## Tests

```bash
cd opus-dropbox && npm test
```

The tests run against a fake Dropbox and a fake Opus over real HTTP (`test/fakes.mjs`), so they cost nothing and need no keys.

### Settings and another cut

`settings` shows the template, clip length, folders and maxInFlight without credentials.
`templates` lists brand templates with the same numbers as setup, including 0 for Opus's default.
`settings template <number>` and `settings length <number>` save a choice. Length numbers are
0 for Opus picks, 1 for under 30 seconds, 2 for 30 to 60 seconds, 3 for 60 to 90 seconds,
and 4 for 90 seconds to 3 minutes. Settings apply only to new sends.

`recut "<file name>"` previews moving a filed done original back to the drop folder.
`recut "<file name>" --yes` confirms it. The next run sends it to Opus again, costing at
least 10 Opus credits. Old clips stay and new clips get a new folder. Ambiguous names
and videos that have not finished cannot be re-cut.

### Claude watcher

`watch` prints JSON health, counts, videos in Opus, items needing a look, and newly done
videos since the last watch. It never sends a video or moves a file. Only watcher metadata
is saved, when the run lock is available. `watch --notify` also alerts once per distinct
problem set until it changes or clears.

`watcher install` writes the routine and attended skill under the current HOME's `.claude`
folder, adds only exact read commands to Claude permissions, and prints a prompt to paste
in the Claude app Code tab (also copied when pbcopy is available). Paste it to create and
enable `opus-watch`, running at minute 7 each hour from 7 through 21. Existing Claude
settings are backed up before merging; an unreadable settings file is left alone.
The routine only reports. The attended skill requires a clear yes for the named video
and the credit cost before invoking a re-cut.


### Local command center

Run `node bin/opus-dropbox.mjs panel` and open http://127.0.0.1:53690 on this Mac.
The page shows health, videos, finished reels and captions, settings, and controls for
another cut and pausing or resuming the background job. Settings apply to new sends.
Another cut needs confirmation and costs at least 10 Opus credits; old clips stay.

`panel install` installs the separate `com.pingel.opus-dropbox-panel` LaunchAgent
with RunAtLoad and KeepAlive, logs to `panel.log` in the tool home, and creates
`~/Desktop/Opus Command Center.webloc`. Running it again updates the same files.
The kit installer also runs this command. `panel uninstall` removes that agent and
shortcut. Neither command changes the existing run agent; `stop` and `start`
still control only the run job.

The page listens only on IPv4 loopback, port 53690. A busy port produces an error.
It checks Host on every request and requires a matching Origin, JSON and a per start
token for every POST. It serves no local files and exposes no account keys or share
links. Loading the page and health reports does not change watcher metadata.
Reels load on demand, 30 at a time, with a 60 second cache and captions capped at
64 KB. Dropbox links open the configured paths relative to the Dropbox root.
The page is local to this Mac, including when viewed at a narrow window width.
