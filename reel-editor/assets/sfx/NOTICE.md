# Sound effects

Small CC0 sounds the editor places on its own edits (a card landing, a word slam, a camera move, the cold-open flash, a marker stroke). Converted to 48 kHz mono WAV at -6 dB peak. No attribution is required; the sources are listed so anyone can check.

| File | Source | License |
| --- | --- | --- |
| card.wav | Kenney "Interface Sounds" (drop_004), https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| marker.wav | Kenney "Interface Sounds" (scratch_002), https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| move.wav, flash.wav | Remotion sound library "whoosh", https://remotion.media/whoosh.wav (freesound 831936 by 1bob) | CC0 1.0 |
| slam.wav | Remotion sound library "whip", https://remotion.media/whip.wav | CC0, "can be used without attribution" per remotion.dev/docs/sfx |
| card-2.wav, card-3.wav, move-2.wav, move-3.wav, slam-2.wav, slam-3.wav | pitch variants (+7% / -7%) of the files above, made with ffmpeg asetrate | same as the source file |
| ding.wav, typing.wav | synthesized for this project with ffmpeg (sine tones; filtered noise clicks) | CC0 1.0 (original) |

`onsets.json` measures these files without modifying them: `attackSample` is the first sample frame at 10% of the absolute peak across channels; `peakSample` is the first absolute maximum. Seconds are sample indexes divided by `sampleRate`. The event clock uses the peak for impacts and the attack for typing. SHA-256 covers each complete WAV, including metadata. `test/event-clock.test.mjs` remeasures every WAV and rejects a stale or missing entry. Regenerate `files` with `measureSfx(fs.readFileSync(file))` from `src/event-clock.mjs` after an intentional asset change.
