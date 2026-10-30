# Content Studio: onboarding a client

The checklist for turning a signed client into a Content Studio that posts for them. Content Studio is the hands-off client kit: it makes their carousels, statics and reels and schedules them in their Metricool, and nobody reviews them before they post. It is never Greg's own setup.

## What the client gives you before the install

| # | What | Why it matters |
|---|---|---|
| 1 | **A Mac** (Apple Silicon, macOS 15 or newer, about 20 GB free) and its admin password | The installer adds Apple's command line tools and Homebrew (Python, ffmpeg, Node) |
| 2 | **Claude, signed in on that Mac** (Pro or Max; open Terminal, type `claude`, sign in) | Claude writes every post in their voice. **The installer stops without it.** |
| 3 | **Metricool** with their **Instagram connected** (Business or Creator account linked to a Facebook Page), plus LinkedIn if they want it | Posts are scheduled into their Metricool brand. Without Instagram connected, nothing can post. |
| 4 | **The Metricool connector in Claude** (claude.ai, Settings, Connectors, Metricool) | Lets their Claude schedule posts and read their calendar |
| 5 | **A photo folder**: 60 or more real photos of them, varied scenes, added to monthly | Every slide uses a real photo, and a photo is never used twice. Under 20 unused photos, carousels get shorter and more typographic. |
| 6 | **Brand inputs**: logo, colors, fonts (or "use our defaults") and 3 to 5 posts they love | Becomes their brand kit (colors, fonts and the slide and reel looks) |
| 7 | **A 30-minute brand interview** with you | Becomes `brand-guide.md`: their content mix, voice, offer and never-say list. Without it the mix is generic. |
| 8 | **Optional**: a ChatGPT account (Codex, for AI B-roll stills), an ElevenLabs key (better transcription) | Reels work without both; AI pictures are always labelled |

## What you do

1. **Write the brand guide** from the interview (pingel-hq `brand-guide-builder`), then build their kit:
   `node scripts/brand-kit.mjs --studio <their brand-guide.md>` gives you `<Name> Content Studio Kit.zip`.
2. **Send the zip.** The client unzips it and double-clicks `Install Content Studio.command`, with you on a call. It takes about 15 minutes. It asks for:
   - their photo folder;
   - which Metricool brand to post to;
   - their time zone and posting times;
   - how images get hosted for Metricool:
     - **Link tool (default):** a short-lived public link from their Mac. It needs nothing else, but the Mac must be on at posting-prep time.
     - **Google Drive or Dropbox:** needs that connector in their Claude. Not yet tested live.
3. **First two weeks: drafts.** Set `publish.mode` to `draft` in their `studio.json`. Every post lands in their Metricool as a draft, so they (or you) can look before approving.
4. **Then hands-off.** Switch `publish.mode` to `schedule`. Posts go out on their own, and anything the checks hold stays out with a note.
5. **Weekly:** run `reel studio status --studio "<their Content Studio>"`. It shows the last posts, anything held and why, and how many unused photos are left.

## What the client does every day

- Drop new photos into their photo folder and clips into `Content Studio/Raw Reels`.
- Leave the Mac on (asleep is fine; the daily job wakes with it). The daily job fills the next open slots, and the reels watcher edits and schedules clips.

## What runs on every post, automatically

- **Word budget and layout rules:** short covers, a slide 2 that differs from slide 1, and 2 or 3 "keep this" slides in teaching posts.
- **Photo finishing:** one consistent treatment per post, and it never touches skin.
- **The slide check:** every word read back, no text on a face, readable contrast, no reused photo, clean copy.
- **The grid check:** the new tile against their last 11, at Instagram's 3:4 crop.
- **Reels:** the text check (clipped text, text on a face, an unreadable hook) holds a bad reel as a draft.
- **Alt text** on every image, and the **AI label** whenever a picture is AI-made.

## Known limits (tell the client)

- No music on carousels or statics. Instagram's API can't add it; they add it in the app if they want.
- Metricool caps carousels at 10 slides.
- A held post leaves that slot empty, with a note in their Content Studio log. It doesn't post something broken.
- Only real photos of them. No stock, and AI pictures never show a person.
