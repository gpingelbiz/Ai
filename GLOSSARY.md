# Reel Editor

The `reel` tool turns a raw talking-head recording into a finished, captioned short video for Greg and, through client kits, for his clients.

## Edits

**Reel**:
One finished short video made from one recording.
_Avoid_: Clip (a clip is cut from a longer source), video, post

**Edit**:
One run of the tool that turns a recording into a reel. Every edit runs the same steps in the same order.
_Avoid_: Job, build, pipeline run

**Work folder**:
The folder that holds everything one edit made and decided, including the saved results of every paid step, so the edit can be re-run without paying again.
_Avoid_: Job folder, output folder, cache

**Edit plan**:
The complete record of one edit's decisions: every cut, caption, card, B-roll shot and timing. Two edits with the same edit plan produce the same reel.
_Avoid_: Project, timeline

**Step**:
One named stage of an edit. The steps, in order: words, second opinion, word fix, cut plan, clean footage, captions and hook, cards, B-roll, audio extras.
_Avoid_: Stage, phase, pass

**Plan check**:
Re-running saved edits from copies of their work folders, without rendering and without paid services, and comparing the new edit plan with the old one exactly.
_Avoid_: Golden test (that compares rendered frames of one fixed edit plan)

## On screen

**Look**:
A named visual style a reel is rendered in, such as glow (Greg's default), bold, or a client's own look.
_Avoid_: Theme, style, skin

**Hook**:
The headline on screen during a reel's first seconds.
_Avoid_: Title, intro

**Card**:
A full-screen or overlay graphic written from what the speaker says, such as a headline, list or number.
_Avoid_: Graphic, slide, overlay

**B-roll**:
Footage or images shown instead of or beside the speaker to picture what is being said.
_Avoid_: Cutaway, stock

## Shipping

**Client kit**:
The copy of this tool that runs on a client's own Mac, released nightly from main.
_Avoid_: Install, package
