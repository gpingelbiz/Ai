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
