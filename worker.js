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

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (url.pathname === "/") {
    return textResponse("FK Downloader Worker is running");
  }

  const videoUrl = url.searchParams.get("url");
  const service = url.searchParams.get("service");

  if (!videoUrl || !service) {
    return textResponse("Missing url or service parameter", 400);
  }

  try {
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
  } catch (err) {
    return textResponse(
      "Error: " + (err instanceof Error ? err.message : String(err)),
      500,
    );
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
