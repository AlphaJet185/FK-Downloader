const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sanitizeFileName(name) {
  return (name || "download").replace(/[^\w\d]+/g, "_");
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      ...headers,
    },
  });
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...headers,
    },
  });
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

function workerThumbUrl(requestUrl, videoId) {
  const url = new URL(requestUrl);
  url.pathname = "/thumb";
  url.search = `?id=${encodeURIComponent(videoId)}`;
  return url.toString();
}

function toSearchVideo(renderer, requestUrl) {
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

  return {
    id,
    title,
    channel,
    duration: parseDuration(durationText),
    thumbnail: workerThumbUrl(requestUrl, id),
    url: `https://youtube.com/watch?v=${id}`,
  };
}

async function handleSearch(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (!query) {
    return jsonResponse({ error: "Query required" }, 400);
  }

  const response = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    },
  );

  if (!response.ok) {
    throw new Error(`YouTube search request failed with status ${response.status}`);
  }

  const html = await response.text();
  const initialData = extractInitialData(html);
  const renderers = collectVideoRenderers(initialData);
  const videos = renderers
    .map((renderer) => toSearchVideo(renderer, request.url))
    .filter(Boolean)
    .slice(0, 10);

  return jsonResponse(videos);
}

async function handleSuggest(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (!query) {
    return jsonResponse([], 200);
  }

  const response = await fetch(
    `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`,
    {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    },
  );

  if (!response.ok) {
    throw new Error(`Suggestion request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const suggestions = Array.isArray(payload?.[1]) ? payload[1] : [];
  return jsonResponse(suggestions);
}

async function handleThumb(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return textResponse("Missing id parameter", 400);
  }

  const thumbUrl = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  const response = await fetch(thumbUrl, {
    headers: {
      Referer: "https://www.youtube.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });

  if (!response.ok || !response.body) {
    return textResponse("Thumbnail not found", 404);
  }

  const headers = new Headers(corsHeaders);
  headers.set(
    "Content-Type",
    response.headers.get("content-type") || "image/jpeg",
  );
  headers.set("Cache-Control", "public, max-age=3600");

  return new Response(response.body, {
    status: 200,
    headers,
  });
}

async function handleDownload(request, env) {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("url");
  const service = url.searchParams.get("service");

  if (!videoUrl || !service) {
    return textResponse("Missing url or service parameter", 400);
  }

  let apiKey = "";
  let apiEndpoint = "";

  if (service === "gemini") {
    apiKey = env.GEMINI_KEY || "";
    apiEndpoint = `https://api.gemini.com/download?url=${encodeURIComponent(videoUrl)}&key=${encodeURIComponent(apiKey)}`;
  } else if (service === "audd") {
    apiKey = env.AUDD_KEY || "";
    apiEndpoint = `https://api.audd.io/?url=${encodeURIComponent(videoUrl)}&api_token=${encodeURIComponent(apiKey)}`;
  } else {
    return textResponse("Invalid service", 400);
  }

  if (!apiKey) {
    return textResponse(`Missing ${service.toUpperCase()} key`, 500);
  }

  const apiResponse = await fetch(apiEndpoint, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!apiResponse.ok) {
    return textResponse(`Upstream API failed with status ${apiResponse.status}`, 502);
  }

  const data = await apiResponse.json();

  if (!data.download_url) {
    return textResponse("Download URL not found", 404);
  }

  const fileResponse = await fetch(data.download_url, {
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!fileResponse.ok || !fileResponse.body) {
    return textResponse(`File source failed with status ${fileResponse.status}`, 502);
  }

  const fileName = sanitizeFileName(data.title || "download");

  return new Response(fileResponse.body, {
    headers: {
      ...corsHeaders,
      "Content-Type":
        fileResponse.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}.mp4"`,
    },
  });
}

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (url.pathname === "/") {
    const hasSearch = url.searchParams.has("q");
    const hasDownload = url.searchParams.has("url");

    if (hasSearch) {
      return handleSearch(request);
    }

    if (hasDownload) {
      return handleDownload(request, env);
    }

    return textResponse("FK Downloader Worker is running");
  }

  if (url.pathname === "/search") {
    return handleSearch(request);
  }

  if (url.pathname === "/suggest") {
    return handleSuggest(request);
  }

  if (url.pathname === "/thumb") {
    return handleThumb(request);
  }

  if (url.pathname === "/download") {
    return handleDownload(request, env);
  }

  return textResponse("Not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      return textResponse(
        "Error: " + (err instanceof Error ? err.message : String(err)),
        500,
      );
    }
  },
};
