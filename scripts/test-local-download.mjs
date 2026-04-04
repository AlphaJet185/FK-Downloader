import youtubedl from "youtube-dl-exec";

const url = process.argv[2] || "https://youtube.com/watch?v=dQw4w9WgXcQ";

try {
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    youtubeSkipDashManifest: true,
  });

  if (!info || typeof info === "string") {
    throw new Error("yt-dlp returned an unexpected payload");
  }

  const directFormat =
    info.formats?.find(
      (format) =>
        format?.url &&
        format?.vcodec &&
        format.vcodec !== "none" &&
        format?.acodec &&
        format.acodec !== "none",
    ) ||
    info.formats?.find((format) => format?.url);

  console.log(
    JSON.stringify(
      {
        title: info.title,
        uploader: info.uploader,
        duration: info.duration,
        formatCount: info.formats?.length || 0,
        sampleDownloadUrl: directFormat?.url || null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
