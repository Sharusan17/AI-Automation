const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();

// Uploads go to /tmp (Railway-safe)
const upload = multer({
  dest: "/tmp",
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "FFmpeg Railway API running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ✅ DOWNLOAD ENDPOINT
app.get("/download/:filename", (req, res) => {
  const filePath = path.join("/tmp", req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${req.params.filename}`
  );

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  stream.on("close", () => {
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted ${filePath}`);
    } catch (e) {
      console.error("Cleanup failed:", e.message);
    }
  });
});

// ✅ RENDER ENDPOINT
app.post(
  "/render",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "captions", maxCount: 1 },
  ]),
  async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    try {
      console.log(`\n==============================`);
      console.log(`[${requestId}] POST /render`);

      if (!req.files?.video?.[0] || !req.files?.audio?.[0]) {
        return res.status(400).json({
          error: "Missing required files: video, audio",
        });
      }

      const videoPath = req.files.video[0].path;
      const audioPath = req.files.audio[0].path;
      const captionsPath = req.files?.captions?.[0]?.path || null;

      const filename = `final_${Date.now()}.mp4`;
      const outPath = path.join("/tmp", filename);

      let filter =
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

      if (captionsPath) {
        filter += `,subtitles=${captionsPath}:force_style='Fontsize=42,Outline=2,Alignment=2,MarginV=80'`;
      }

      const args = [
        "-y",

        // Input
        "-i", videoPath,
        "-i", audioPath,

        // Duration
        "-t", "60",
        "-shortest",

        // Video
        "-vf", filter,
        "-r", "30",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-threads", "2",
        "-pix_fmt", "yuv420p",

        // Audio
        "-c:a", "aac",
        "-b:a", "128k",

        // Fast MP4
        "-movflags", "+faststart",

        outPath,
      ];

      console.log(`[${requestId}] FFmpeg starting...`);
      const start = Date.now();

      execFile("ffmpeg", args, (err, stdout, stderr) => {
        const durationMs = Date.now() - start;
        console.log(`[${requestId}] FFmpeg finished in ${durationMs}ms`);

        if (stderr) {
          console.log(
            `[${requestId}] FFmpeg stderr:\n${stderr.slice(0, 2000)}`
          );
        }

        if (err) {
          console.error(`[${requestId}] FFmpeg ERROR`, err);
          return res.status(500).json({
            error: "FFmpeg failed",
            details: stderr?.slice(0, 1000),
          });
        }

        if (!fs.existsSync(outPath)) {
          return res.status(500).json({
            error: "Output file missing",
          });
        }

        const stats = fs.statSync(outPath);

        // ✅ RETURN DOWNLOAD LINK (THIS IS THE KEY FIX)
        res.json({
          success: true,
          requestId,
          output: {
            filename,
            sizeBytes: stats.size,
            durationMs,
            downloadUrl: `https://${req.headers.host}/download/${filename}`,
          },
        });

        // Cleanup inputs only
        [videoPath, audioPath, captionsPath].forEach((p) => {
          if (p && fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch {}
          }
        });
      });
    } catch (e) {
      console.error("Server error", e);
      res.status(500).json({ error: "Server error" });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`FFmpeg Railway API listening on port ${PORT}`)
);
