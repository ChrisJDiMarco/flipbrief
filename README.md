# FlipBrief

FlipBrief turns YouTube videos into concise, visual flipbooks.

## Run

```bash
npm install
npm run dev
```

## Package

```bash
npm run dist
```

The Chrome extension lives in `ChromeExtension/` and talks to the app over a local, token-protected loopback server.

## Keys

Set keys in the app settings:

- `YOUTUBE_API_KEY` for playlist imports.
- `OPENAI_API_KEY` for AI summaries. If absent or the call fails, FlipBrief falls back to a deterministic transcript summary.

