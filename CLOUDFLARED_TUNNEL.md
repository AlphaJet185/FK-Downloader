# Cloudflared Tunnel

This repo includes a starter config for exposing the local downloader backend through Cloudflare Tunnel.

Files:

- [`.cloudflared/config.yml`](/E:/Zoro/FK/.cloudflared/config.yml)

## Quick temporary tunnel

If `cloudflared` is installed on the machine:

```cmd
cd /d E:\Zoro\FK
npm start
```

In another terminal:

```cmd
npm run tunnel:quick
```

That creates a temporary public URL pointing to:

```text
http://localhost:3000
```

## Named tunnel

Login:

```cmd
cloudflared tunnel login
```

Create the tunnel:

```cmd
cloudflared tunnel create fk-downloader
```

Then update [`.cloudflared/config.yml`](/E:/Zoro/FK/.cloudflared/config.yml):

- replace `downloader.example.com` with your real hostname
- keep `service: http://localhost:3000`

Run it:

```cmd
npm start
```

In another terminal:

```cmd
npm run tunnel:run
```

## Important

- The tunnel only works while your PC and `cloudflared` are running.
- The credentials file created by Cloudflare is intentionally ignored by git.
