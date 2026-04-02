# Cloudflare Worker Setup

This repo includes a Worker entry at [worker.js](E:/Zoro/FK/worker.js).

## What it expects

- Query parameter `url`
- Query parameter `service`
- `service=gemini` uses secret `GEMINI_KEY`
- `service=audd` uses secret `AUDD_KEY`

## Install Wrangler

```cmd
npm install -g wrangler
```

## Log in

```cmd
wrangler login
```

## Add secrets

```cmd
wrangler secret put GEMINI_KEY
wrangler secret put AUDD_KEY
```

## Run locally

```cmd
npm run worker:dev
```

## Deploy

```cmd
npm run worker:deploy
```

Or:

```cmd
wrangler publish
```

## Example calls

```text
https://your-worker-name.workers.dev/?url=https://youtube.com/watch?v=dQw4w9WgXcQ&service=gemini
https://your-worker-name.workers.dev/?url=https://youtube.com/watch?v=dQw4w9WgXcQ&service=audd
```

## Notes

- Secrets stay in Cloudflare and are not committed to the repo.
- The Worker streams the upstream `download_url` back to the client.
- If your upstream provider needs a different response shape, update [worker.js](E:/Zoro/FK/worker.js).
