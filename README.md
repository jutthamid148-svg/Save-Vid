# VidGrab

Fast, offline-capable desktop video downloader for Windows. Paste a link, pick a
quality, save it. Built on Electron + `yt-dlp`.

## Supported platforms

| Platform | Video | Audio |
| --- | --- | --- |
| YouTube | MP4, up to 4K | MP3 |
| Facebook | MP4 (public videos) | MP3 |
| Instagram | MP4 (public reels & posts) | MP3 |
| X / Twitter | MP4 | MP3 |
| TikTok | MP4 (public, no watermark) | MP3 |
| SoundCloud | — | MP3 |
| Vimeo, Dailymotion, and direct `.mp4` links | MP4 | MP3 |

## Features

- **Quality picker** — every height yt-dlp reports, sorted best-first, with size hints
- **Audio extraction** — one-click MP3 at best bitrate
- **Subtitles** — manual + auto-generated, converted to SRT
- **Progress with real byte counts** — indeterminate bar until the total size is known,
  then live percentage, speed and ETA from yt-dlp
- **Cancel** — kills the whole process tree (Windows included)
- **Resume** — `--continue`, so a dropped connection picks up where it left off
- **Speed** — 4 concurrent fragments, 5 retries, no partial-file churn
- **Output folder picker**, sanitised file names, "Show in folder" on completion

## Requirements

- Windows 10/11
- **yt-dlp** on your PATH, or bundled in `resources/yt-dlp.exe`, or pointed to by
  the `YT_DLP_PATH` environment variable.

The app checks the engine on launch and shows its version in the top-right pill.
If it says `yt-dlp not found`, grab a build from
<https://github.com/yt-dlp/yt-dlp#installation> and either drop `yt-dlp.exe` into
`resources/` or set `YT_DLP_PATH`.

## Development

```bash
npm install
npm start
```

## Build an installer

```bash
npm run dist
```

Produces an NSIS installer in `dist/`. Note: build **outside OneDrive** — sync
locks on `node_modules` cause install failures. A working copy lives at
`C:\Users\Admin\vidgrab-build`.

To ship a self-contained installer, add `yt-dlp.exe` to `resources/` first; it is
picked up automatically and bundled via the `files` glob in `package.json`.

## Use responsibly

This tool saves video you have the right to save. Downloading your own uploads,
Creative Commons material, or content you have permission for is fine. Stay
within each platform's terms of service and applicable copyright law — many sites
prohibit downloading even when a download is technically possible.

Private, age-restricted, or paywalled content is out of scope. VidGrab ships with
no ad SDK, no telemetry, and no network calls other than the download itself.
