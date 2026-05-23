import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import youtubedl from "youtube-dl-exec";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const appRootDir = process.env.FK_APP_ROOT?.trim()
  ? path.resolve(process.env.FK_APP_ROOT)
  : path.dirname(modulePath);
const runtimeRootDir = process.env.FK_RUNTIME_DIR?.trim()
  ? path.resolve(process.env.FK_RUNTIME_DIR)
  : path.join(os.tmpdir(), "fk-downloader");

function firstExistingPath(candidates = []) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

const envFilePath = firstExistingPath([
  process.env.FK_ENV_FILE?.trim(),
  typeof process.resourcesPath === "string"
    ? path.join(process.resourcesPath, ".env.local")
    : "",
  path.join(appRootDir, ".env.local"),
  path.join(process.cwd(), ".env.local"),
]);

if (envFilePath) {
  dotenv.config({ path: envFilePath });
} else {
  dotenv.config();
}

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const useViteDevServer =
  !isProduction && process.env.FK_USE_VITE_DEV === "1";
const PUBLIC_DIR = path.join(appRootDir, "public");
const STATIC_DIR = path.join(appRootDir, "static");
const INDEX_HTML_PATH = path.join(appRootDir, "index.html");
const YT_DLP_SCRIPT_PATH =
  firstExistingPath([
    process.env.FK_YT_DLP_PATH?.trim(),
    typeof process.resourcesPath === "string"
      ? path.join(process.resourcesPath, "bin", "yt-dlp")
      : "",
    path.join(appRootDir, "bin", "yt-dlp"),
  ]) || path.join(appRootDir, "bin", "yt-dlp");
const YT_DLP_TEMP_DIR = path.join(runtimeRootDir, "yt-dlp");
const YT_DLP_HEADER_VALUES = [
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Referer: https://www.youtube.com/",
];

app.use(cors());

let vite = null;

if (!useViteDevServer) {
  app.use(express.static(PUBLIC_DIR));
} else {
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  vite = await createServer({
    root: appRootDir,
    appType: "spa",
    configFile: false,
    cacheDir: path.join(runtimeRootDir, "vite"),
    plugins: [react()],
    publicDir: STATIC_DIR,
    resolve: {
      preserveSymlinks: true,
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [],
      esbuildOptions: {
        preserveSymlinks: true,
      },
    },
    build: {
      outDir: PUBLIC_DIR,
      emptyOutDir: true,
    },
    server: {
      middlewareMode: true,
    },
  });
}

const API_KEY = process.env.YOUTUBE_API_KEY;

function firstArrayValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeVideoUrl(input) {
  if (!input || typeof input !== "string") return "";
  return input.trim();
}

function objectToArgs(options = {}) {
  const args = [];

  for (const [key, value] of Object.entries(options)) {
    const flag = `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;

    if (typeof value === "boolean") {
      if (value) {
        args.push(flag);
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        args.push(flag, String(item));
      }
      continue;
    }

    if (value !== undefined && value !== null && value !== "") {
      args.push(flag, String(value));
    }
  }

  return args;
}

function buildYtDlpOptions(extraOptions = {}) {
  return {
    noPlaylist: true,
    noWarnings: true,
    extractorRetries: 10,
    forceIpv4: true,
    noCheckCertificates: true,
    addHeader: YT_DLP_HEADER_VALUES,
    ...extraOptions,
  };
}

function parseYtDlpOutput(stdout = "") {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  return trimmed;
}

function formatYtDlpError(error) {
  const message = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === "string" && value.trim())
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.startsWith("ERROR:")) ||
    [error?.stderr, error?.stdout, error?.message]
      .filter((value) => typeof value === "string" && value.trim())
      .flatMap((value) => value.split(/\r?\n/))
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ||
    "yt-dlp failed";

  return new Error(message.replace(/^ERROR:\s*/, ""));
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        maxBuffer: 50 * 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }

        try {
          resolve(parseYtDlpOutput(stdout));
        } catch (parseError) {
          parseError.stdout = stdout;
          parseError.stderr = stderr;
          reject(parseError);
        }
      },
    );
  });
}

async function runRepoYtDlp(url, options = {}) {
  await fsp.mkdir(YT_DLP_TEMP_DIR, { recursive: true });

  const args = [...objectToArgs(buildYtDlpOptions(options)), url];
  const env = {
    ...process.env,
    TEMP: YT_DLP_TEMP_DIR,
    TMP: YT_DLP_TEMP_DIR,
  };
  const commandCandidates =
    process.platform === "win32"
      ? [
          ["py", ["-3", YT_DLP_SCRIPT_PATH]],
          ["python", [YT_DLP_SCRIPT_PATH]],
        ]
      : [
          [YT_DLP_SCRIPT_PATH, []],
          ["python3", [YT_DLP_SCRIPT_PATH]],
          ["python", [YT_DLP_SCRIPT_PATH]],
        ];

  let lastError = null;

  for (const [command, prefixArgs] of commandCandidates) {
    try {
      return await execFileAsync(command, [...prefixArgs, ...args], { env });
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw lastError || new Error("Unable to find a Python runtime for yt-dlp");
}

async function runYtDlp(url, options = {}) {
  if (fs.existsSync(YT_DLP_SCRIPT_PATH)) {
    try {
      return await runRepoYtDlp(url, options);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw formatYtDlpError(error);
      }
    }
  }

  try {
    return await youtubedl(url, buildYtDlpOptions(options));
  } catch (error) {
    throw formatYtDlpError(error);
  }
}

function normalizeFormats(formats = []) {
  return formats
    .filter((format) => format?.url)
    .map((format) => ({
      formatId: format.format_id || "",
      ext: format.ext || "",
      quality:
        format.format_note ||
        format.height ||
        (format.vcodec === "none" ? "audio" : "video"),
      url: format.url,
      acodec: format.acodec || "",
      vcodec: format.vcodec || "",
      filesize: format.filesize || format.filesize_approx || null,
    }));
}

function normalizeInfoFormats(formats = [], sourceUrl = "") {
  return formats
    .filter((format) => format?.url)
    .map((format) => ({
      itag: format.format_id,
      qualityLabel:
        format.vcodec === "none"
          ? format.abr || format.tbr
            ? `${Math.round(format.abr || format.tbr)} kbps`
            : "Audio"
          : format.height
            ? `${format.height}p`
            : format.format_note || format.format || "Video",
      bitrate: format.tbr || format.vbr || format.abr || 0,
      mimeType: format.ext
        ? `${format.vcodec !== "none" ? "video" : "audio"}/${format.ext}`
        : undefined,
      hasVideo: format.vcodec !== "none",
      hasAudio: format.acodec !== "none",
      height: Number(format.height || 0),
      contentLength:
        format.filesize || format.filesize_approx
          ? `${(Number(format.filesize || format.filesize_approx) / (1024 * 1024)).toFixed(2)}M`
          : "Unknown",
      url: `/api/download?url=${encodeURIComponent(sourceUrl)}&itag=${encodeURIComponent(format.format_id || "")}`,
    }));
}

function uniqueBy(items = [], getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickDirectDownloadUrl(info) {
  const formats = normalizeFormats(info?.formats || []);

  const progressive = formats.find(
    (format) =>
      format.url &&
      format.vcodec &&
      format.vcodec !== "none" &&
      format.acodec &&
      format.acodec !== "none",
  );

  if (progressive?.url) return progressive.url;

  const videoOnly = formats.find(
    (format) => format.url && format.vcodec && format.vcodec !== "none",
  );

  if (videoOnly?.url) return videoOnly.url;

  const audioOnly = formats.find(
    (format) => format.url && format.acodec && format.acodec !== "none",
  );

  return audioOnly?.url || "";
}

function sanitizeFileName(input = "") {
  return (
    input
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "download"
  );
}

function buildContentDispositionAttachment(fileName = "download") {
  const safeName = sanitizeFileName(fileName).replace(/[\r\n]/g, "").trim();
  const asciiFallback =
    safeName
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "")
      .trim() || "download";

  const encoded = encodeURIComponent(safeName).replace(/['()]/g, escape);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function pickRequestedFormat(info, type, itag = "") {
  const formats = Array.isArray(info?.formats)
    ? info.formats.filter((format) => format?.url && format?.ext !== "webm")
    : [];

  if (itag) {
    return (
      formats.find((format) => String(format?.format_id || "") === itag) || null
    );
  }

  if (type === "audio") {
    return (
      formats
        .filter((format) => format.vcodec === "none" && format.acodec !== "none")
        .sort(
          (a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0),
        )[0] || null
    );
  }

  return (
    formats
      .filter(
        (format) =>
          format.vcodec !== "none" &&
          format.acodec !== "none" &&
          format.ext === "mp4",
      )
      .sort(
        (a, b) =>
          (b.height || 0) - (a.height || 0) ||
          (b.tbr || 0) - (a.tbr || 0),
      )[0] ||
    formats
      .filter(
        (format) =>
          format.vcodec !== "none" && format.acodec !== "none",
      )
      .sort(
        (a, b) =>
          (b.height || 0) - (a.height || 0) ||
          (b.tbr || 0) - (a.tbr || 0),
      )[0] ||
    null
  );
}

function getStableThumbnail(videoId, fallback = "") {
  if (!videoId) return fallback;
  return `/api/thumb?id=${encodeURIComponent(videoId)}`;
}

function parseDuration(text = "") {
  const parts = text
    .split(":")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) return 0;
  return parts.reduce((total, value) => total * 60 + value, 0);
}

function extractInitialData(html) {
  const patterns = [
    /var ytInitialData = (\{.*?\});<\/script>/s,
    /window\["ytInitialData"\] = (\{.*?\});<\/script>/s,
    /ytInitialData = (\{.*?\});<\/script>/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return JSON.parse(match[1]);
    }
  }

  throw new Error("Unable to parse YouTube search payload");
}

function collectVideoRenderers(node, results = []) {
  if (!node || typeof node !== "object") return results;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, results);
    }
    return results;
  }

  if (node.videoRenderer) {
    results.push(node.videoRenderer);
  }

  for (const value of Object.values(node)) {
    collectVideoRenderers(value, results);
  }

  return results;
}

function toSearchVideo(renderer) {
  const id = renderer?.videoId;
  const title =
    renderer?.title?.runs?.map((run) => run?.text).join("") ||
    renderer?.title?.simpleText ||
    "";

  if (!id || !title) return null;

  const channel =
    renderer?.ownerText?.runs?.[0]?.text ||
    renderer?.longBylineText?.runs?.[0]?.text ||
    renderer?.shortBylineText?.runs?.[0]?.text ||
    "";

  const durationText =
    renderer?.lengthText?.simpleText ||
    renderer?.lengthText?.runs?.map((run) => run?.text).join("") ||
    "";

  const thumbUrl =
    renderer?.thumbnail?.thumbnails?.at?.(-1)?.url ||
    renderer?.thumbnail?.thumbnails?.[0]?.url ||
    "";

  return {
    id,
    title,
    channel,
    duration: parseDuration(durationText),
    thumbnail: getStableThumbnail(id, thumbUrl),
    url: `https://youtube.com/watch?v=${id}`,
  };
}

function downloadContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();

  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".opus":
      return "audio/opus";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

async function cleanupDirectory(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.error("cleanup error", error);
  }
}

app.get("/video-info", async (req, res) => {
  const rawUrl = firstArrayValue(req.query.url);
  const url = normalizeVideoUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "No URL provided" });
  }

  try {
    const videoId = new URL(url).searchParams.get("v");
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = data.items[0];
    return res.json({
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      thumbnail: video.snippet.thumbnails.high.url,
      views: video.statistics.viewCount,
      published: video.snippet.publishedAt,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Something went wrong", details: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "local-downloader" });
});

app.get("/api/suggest", async (req, res) => {
  const rawQuery = firstArrayValue(req.query.q);
  const q = typeof rawQuery === "string" ? rawQuery.trim() : "";

  if (!q) {
    return res.json([]);
  }

  try {
    const response = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
      },
    );

    if (!response.ok) {
      throw new Error(`Suggestion request failed with status ${response.status}`);
    }

    const payload = await response.json();
    return res.json(Array.isArray(payload?.[1]) ? payload[1] : []);
  } catch (error) {
    console.error("suggest error", error);
    return res.status(500).json([]);
  }
});

app.get("/api/thumb", async (req, res) => {
  const rawId = firstArrayValue(req.query.id);
  const id = typeof rawId === "string" ? rawId.trim() : "";

  if (!id) {
    return res.status(400).send("Video id required");
  }

  try {
    const response = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Thumbnail request failed with status ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("thumbnail proxy error", error);
    return res.status(404).send("Thumbnail not found");
  }
});

app.get("/api/oembed", async (req, res) => {
  const rawUrl = firstArrayValue(req.query.url);
  const url = normalizeVideoUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      },
    );

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Failed to load video from pasted link",
        details: text.slice(0, 300),
      });
    }

    res.setHeader("Content-Type", "application/json");
    return res.send(text);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load video from pasted link",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/info", async (req, res) => {
  const rawUrl = firstArrayValue(req.query.url);
  const url = normalizeVideoUrl(rawUrl);

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const info = await runYtDlp(url, {
      dumpSingleJson: true,
      preferFreeFormats: false,
    });

    if (!info || typeof info === "string") {
      throw new Error("yt-dlp returned an unexpected payload");
    }

    const formats = normalizeInfoFormats(
      info.formats || [],
      info.webpage_url || info.original_url || url,
    );
    const sourceUrl = info.webpage_url || info.original_url || url;
    const m4aFormats = uniqueBy(
      formats
        .filter(
          (format) =>
            !format.hasVideo &&
            format.hasAudio
        )
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)),
      (format) => `${format.itag}-${Math.round(format.bitrate || 0)}-${format.mimeType || ""}`,
    ).map((format) => ({
      ...format,
      url: `/api/download?url=${encodeURIComponent(sourceUrl)}&type=audio&audioFormat=mp4&itag=${encodeURIComponent(format.itag)}`,
    }));

    const bestAudioBitrate = m4aFormats[0]?.bitrate || 0;
    const audioFormats = [
      {
        itag: "mp3",
        qualityLabel: bestAudioBitrate ? `MP3 ${Math.round(bestAudioBitrate)} kbps` : "MP3",
        bitrate: bestAudioBitrate,
        mimeType: "audio/mp3",
        hasVideo: false,
        hasAudio: true,
        height: 0,
        contentLength: m4aFormats[0]?.contentLength || "Unknown",
        url: `/api/download?url=${encodeURIComponent(sourceUrl)}&type=audio&audioFormat=mp3`,
      },
      ...m4aFormats,
    ];

    const videoFormats = uniqueBy(
      formats
        .filter(
          (format) =>
            format.hasVideo,
        )
        .sort((a, b) => {
          const audioDiff = Number(b.hasAudio) - Number(a.hasAudio);
          if (audioDiff !== 0) return audioDiff;
          const heightDiff = (b.height || 0) - (a.height || 0);
          if (heightDiff !== 0) return heightDiff;
          return (b.bitrate || 0) - (a.bitrate || 0);
        }),
      (format) => `${format.itag}-${format.height || format.qualityLabel}-${format.mimeType || ""}-${format.hasAudio}`,
    ).map((format) => ({
      ...format,
      url: `/api/download?url=${encodeURIComponent(sourceUrl)}&type=video&itag=${encodeURIComponent(format.itag)}`,
    }));

    const previewFormat =
      formats
        .filter(
          (format) =>
            format.hasVideo &&
            format.hasAudio &&
            format.mimeType?.includes("mp4"),
        )
        .sort((a, b) => {
          const heightDiff = (b.height || 0) - (a.height || 0);
          if (heightDiff !== 0) return heightDiff;
          return (b.bitrate || 0) - (a.bitrate || 0);
        })[0] || null;

    return res.json({
      id: info.id,
      title: info.title,
      channel: info.channel || info.uploader || "",
      duration: Number(info.duration || 0),
      thumbnail: info.thumbnails?.at(-1)?.url || info.thumbnail,
      url: info.webpage_url || info.original_url || url,
      previewUrl: previewFormat
        ? `/api/download?url=${encodeURIComponent(sourceUrl)}&type=video&itag=${encodeURIComponent(previewFormat.itag)}&preview=1`
        : "",
      audioFormats,
      videoFormats,
    });
  } catch (error) {
    console.error("info error", error);
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to fetch video details",
    });
  }
});

app.get("/api/search", async (req, res) => {
  const rawQuery = firstArrayValue(req.query.q);
  const q = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const rawPage = firstArrayValue(req.query.page);
  const page = Math.max(1, Number.parseInt(String(rawPage || "1"), 10) || 1);
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  if (!q) {
    return res.status(400).json({ error: "Query required" });
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`YouTube search request failed with status ${response.status}`);
    }

    const html = await response.text();
    const initialData = extractInitialData(html);
    const renderers = collectVideoRenderers(initialData);
    const videos = renderers.map(toSearchVideo).filter(Boolean).slice(offset, offset + pageSize);

    return res.json(videos);
  } catch (error) {
    console.error("search error", error);
    return res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/download", async (req, res) => {
  const rawUrl = firstArrayValue(req.query.url);
  const url = normalizeVideoUrl(rawUrl);
  const rawType = firstArrayValue(req.query.type);
  const rawItag = firstArrayValue(req.query.itag);
  const rawAudioFormat = firstArrayValue(req.query.audioFormat);
  const rawPreview = firstArrayValue(req.query.preview);
  const type = rawType === "audio" ? "audio" : "video";
  const itag = typeof rawItag === "string" ? rawItag.trim() : "";
  const audioFormat = rawAudioFormat === "mp3" ? "mp3" : "mp4";
  const isPreview = rawPreview === "1";

  if (!url) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const probeInfo = await runYtDlp(url, {
      dumpSingleJson: true,
      preferFreeFormats: false,
    });

    if (!probeInfo || typeof probeInfo === "string") {
      throw new Error("yt-dlp returned an unexpected payload");
    }

    const selectedFormat = pickRequestedFormat(probeInfo, type, itag);
    const canStreamDirectly =
      !!selectedFormat?.url &&
      ((type === "audio" && audioFormat === "mp4") ||
        (type === "video" &&
          selectedFormat?.acodec &&
          selectedFormat.acodec !== "none"));

    if (canStreamDirectly) {
      const ext =
        selectedFormat?.ext || (type === "audio" ? "m4a" : "mp4");
      const fileName = `${sanitizeFileName(probeInfo.title || "download")}.${ext}`;
      const upstreamHeaders = {
        "User-Agent": "Mozilla/5.0",
      };

      if (typeof req.headers.range === "string" && req.headers.range) {
        upstreamHeaders.Range = req.headers.range;
      }

      const upstreamResponse = await fetch(selectedFormat.url, {
        headers: upstreamHeaders,
      });

      if (!upstreamResponse.ok || !upstreamResponse.body) {
        throw new Error(
          `Media request failed with status ${upstreamResponse.status}`,
        );
      }

      if (upstreamResponse.status === 206) {
        res.status(206);
      }

      res.setHeader(
        "Content-Type",
        upstreamResponse.headers.get("content-type") ||
          downloadContentType(`file.${ext}`),
      );
      if (!isPreview) {
        res.setHeader(
          "Content-Disposition",
          buildContentDispositionAttachment(fileName),
        );
      }

      const contentLength = upstreamResponse.headers.get("content-length");
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }

      const contentRange = upstreamResponse.headers.get("content-range");
      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
      }

      const acceptRanges = upstreamResponse.headers.get("accept-ranges");
      if (acceptRanges) {
        res.setHeader("Accept-Ranges", acceptRanges);
      } else if (isPreview) {
        res.setHeader("Accept-Ranges", "bytes");
      }

      res.setHeader("X-Download-Title", probeInfo.title || "download");
      res.setHeader("X-Download-Type", type);

      return Readable.fromWeb(upstreamResponse.body).pipe(res);
    }

    const tempDir = path.join(
      os.tmpdir(),
      `fk-downloader-${Date.now()}-${crypto.randomUUID()}`
    );
    const outputTemplate = path.join(tempDir, "download.%(ext)s");

    await fsp.mkdir(tempDir, { recursive: true });

    let formatSelector = "";

    if (type === "audio") {
      formatSelector = itag ? itag : "bestaudio[ext=m4a]/bestaudio";
    } else if (selectedFormat?.acodec && selectedFormat.acodec !== "none") {
      formatSelector = itag || "best[ext=mp4]/best";
    } else if (itag) {
      formatSelector = `${itag}+bestaudio[ext=m4a]/${itag}+bestaudio/${itag}`;
    } else {
      formatSelector = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]";
    }

    const downloadOptions = {
      output: outputTemplate,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: false,
      format: formatSelector,
      ...(type === "video"
        ? {
            mergeOutputFormat: "mp4",
          }
        : {}),
      ...(type === "audio" && audioFormat === "mp3"
        ? {
            extractAudio: true,
            audioFormat: "mp3",
            audioQuality: "0",
          }
        : {}),
    };



    await runYtDlp(url, downloadOptions);

    const downloadedFiles = (await fsp.readdir(tempDir))
      .filter((fileName) => !fileName.endsWith(".part"))
      .map((fileName) => path.join(tempDir, fileName));

    const targetFile = downloadedFiles[0];

    if (!targetFile) {
      await cleanupDirectory(tempDir);
      throw new Error("Download file was not created");
    }

    const downloadedExt = path.extname(targetFile) || ".mp4";
    const downloadName = `${sanitizeFileName(probeInfo.title || "download")}${downloadedExt}`;
    res.setHeader("Content-Type", downloadContentType(downloadName));
    if (!isPreview) {
      res.setHeader(
        "Content-Disposition",
        buildContentDispositionAttachment(downloadName),
      );
    }
    res.setHeader("X-Download-Title", probeInfo.title || "download");
    res.setHeader("X-Download-Type", type);

    const stream = fs.createReadStream(targetFile);

    stream.on("error", async (error) => {
      console.error("stream error", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream downloaded file" });
      } else {
        res.destroy(error);
      }
      await cleanupDirectory(tempDir);
    });

    res.on("close", () => {
      void cleanupDirectory(tempDir);
    });

    stream.pipe(res);
  } catch (error) {
    console.error("download error", error);
    return res.status(500).json({
      error: "Download failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

if (vite) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }

    return vite.middlewares(req, res, next);
  });
}

app.use(async (req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    return next();
  }

  try {
    if (vite) {
      const template = await fsp.readFile(INDEX_HTML_PATH, "utf8");
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).setHeader("Content-Type", "text/html");
      return res.end(html);
    }

    return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  } catch (error) {
    if (vite) {
      vite.ssrFixStacktrace(error);
    }

    return next(error);
  }
});

let serverControl = null;

function listenAsync(port, host) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onListening = () => {
      if (settled) return;
      settled = true;
      server.off("error", onError);
      resolve(server);
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const server = host
      ? app.listen(port, host, onListening)
      : app.listen(port, onListening);

    server.once("error", onError);
  });
}

export async function startServer(options = {}) {
  if (serverControl) {
    return serverControl;
  }

  const port = Number(options.port ?? DEFAULT_PORT);
  const host =
    typeof options.host === "string" && options.host.trim()
      ? options.host.trim()
      : undefined;
  const server = await listenAsync(port, host);
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  const displayHost = host || "localhost";

  serverControl = {
    app,
    vite,
    server,
    port: actualPort,
    host: displayHost,
    async close() {
      if (!serverControl) {
        return;
      }

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      serverControl = null;
    },
  };

  console.log(`Server running on http://${displayHost}:${actualPort}`);
  return serverControl;
}

export { app };

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === modulePath
  : false;

if (isDirectExecution) {
  await startServer();
}
