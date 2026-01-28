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

      const outPath = path.join("/tmp", `final_${Date.now()}.mp4`);

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
      
        // Duration control
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
        const duration = Date.now() - start;
        console.log(`[${requestId}] FFmpeg finished in ${duration}ms`);

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

        // ✅ IMPORTANT: DO NOT STREAM FILE
        // Just return metadata for now
        res.json({
          success: true,
          requestId,
          output: {
            path: outPath,
            sizeBytes: stats.size,
            durationMs: duration,
          },
        });

        // Cleanup inputs only (keep output for now)
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
