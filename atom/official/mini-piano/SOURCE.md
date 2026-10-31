# Sources and licenses

ATOM UI and sampled instrument engine: MIT (LICENSE). The original piano UI derives from the owner's GrayOS piano; ATOM retains its own icon and theme/navigation integration. No third-party application code was copied.

## Sound recordings — separate from application license

Salamander Grand Piano v3, Alexander Holm, **CC BY 3.0**.
Original: https://archive.org/details/SalamanderGrandPianoV3
Browser MP3 distribution: https://github.com/tambien/Piano/tree/master/audio
License: licenses/salamander-CC-BY-3.0.txt and https://creativecommons.org/licenses/by/3.0/
ATOM modifications: select velocity layers 5 and 12, tritone sample spacing plus A0; trim to 6 seconds, fade last 0.5 seconds, mono 24 kHz / 32 kbit MP3. The supplied recordings are encoded into samples.js for offline, opaque-iframe and text-bundle compatibility. Attribution and CC BY 3.0 remain applicable to those adapted samples.

## Engraved scores — separate licenses

All MIDI files downloaded directly from Mutopia, not from an unlicensed app. Original file URLs and SHA-256 hashes are retained in asset-sources.json. Source engravings: https://github.com/MutopiaProject/MutopiaProject/tree/master/ftp

| Work | Engraver / maintainer | License of score and ATOM score adaptation |
|---|---|---|
| Chopin Nocturne Op.9 No.2 | Renato Biolcati Rinaldi | CC BY-SA 3.0 https://creativecommons.org/licenses/by-sa/3.0/ |
| Debussy Clair de lune | Keith OHara | Public Domain |
| Joplin Maple Leaf Rag | Chris Sawer | Public Domain |
| Chopin Waltz Op.64 No.1 | Magnus Lewis-Smith | Public Domain |
| Beethoven Moonlight Sonata, movement 3 | Chris Sawer and Stewart Holmes | CC BY-SA 2.5 https://creativecommons.org/licenses/by-sa/2.5/ |

ATOM transformations: MIDI note on/off pairs become JSON beat/pitch/duration/velocity/hand records in songs.js. The two staff tracks are identified by average pitch; this is a playback grouping rather than a fingering prescription. Notes are not truncated to the visible keyboard. Original tempo metadata is retained in asset-sources.json. Playback tempo choices are editorial, not claims of original performance tempo. No third-party recorded performance is included.

The Nocturne data and its expressive rendition remain CC BY-SA 3.0; Moonlight movement 3 data and rendition remain CC BY-SA 2.5. The MIT application license does not replace these licenses. Preserve this file, the recording license and the per-song credits when redistributing.

`import_library.py` downloads the attributed sources and rebuilds offline assets (Python stdlib + ffmpeg). `pianist.js` implements deterministic phrase shaping, melody emphasis and capped release extensions; it is an editorial interpretation, not a recovered pianist's dynamics or original pedal score. “原谱” disables those expressive adjustments. MIDI pitches, durations and simultaneous chords remain represented in both modes.
