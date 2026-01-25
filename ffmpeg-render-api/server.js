const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();

/**
 * Multer config
 * Use /tmp ONLY (Render allows this)
 */
const upload = multer({
  dest: "/tmp",
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB safeguard
  },
});

/**
 * Health checks
 */
app.get("/", (req, res) => {
  res.json({ ok: true, message: "FFmpeg Render API is running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * POST /render
 *
 * multipart/form-data:
 * - video   (mp4 background video)
 * - audio   (mp3 voice)
 * - captions (srt) OPTIONAL
 *
 * RESPONSE:
 * JSON ONLY (no video streaming!)
 */
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
      console.log(`[${requestId}] POST /render started`);

      // Validate uploads
      if (!req.files?.video?.[0] || !req.files?.audio?.[0]) {
        return res.status(400).json({
          success: false,
          requestId,
          error: "Missing required files: video and audio",
        });
      }

      const videoPath = req.files.video[0].path;
      const audioPath = req.files.audio[0].path;
      const captionsPath = req.files?.captions?.[0]?.path || null;

      const outPath = path.join("/tmp", `final_${Date.now()}.mp4`);

      console.log(`[${requestId}] videoPath: ${videoPath}`);
      console.log(`[${requestId}] audioPath: ${audioPath}`);
      console.log(`[${requestId}] captionsPath: ${captionsPath || "none"}`);
      console.log(`[${requestId}] outPath: ${outPath}`);

      /**
       * TikTok 9:16 filter
       */
      let filter =
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

      if (captionsPath) {
        filter += `,subtitles=${captionsPath}:force_style='Fontsize=48,Outline=2,BorderStyle=1,Alignment=2,MarginV=80'`;
      }

      const args = [
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-shortest",
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outPath,
      ];

      console.log(`[${requestId}] FFmpeg args:`, args);

      const start = Date.now();

      execFile("ffmpeg", args, async (err, stdout, stderr) => {
        const duration = Date.now() - start;
        console.log(`[${requestId}] FFmpeg finished in ${duration}ms`);

        if (stderr) {
          console.log(
            `[${requestId}] FFmpeg stderr (trimmed):\n${stderr
              .toString()
              .slice(0, 4000)}`
          );
        }

        if (err) {
          console.error(`[${requestId}] FFmpeg ERROR`, err);
          return res.status(500).json({
            success: false,
            requestId,
            error: "FFmpeg failed",
            details: stderr?.toString()?.slice(0, 2000),
          });
        }

        if (!fs.existsSync(outPath)) {
          return res.status(500).json({
            success: false,
            requestId,
            error: "Output file not generated",
          });
        }

        const stats = fs.statSync(outPath);
        console.log(
          `[${requestId}] Output file size: ${stats.size} bytes`
        );

        /**
         * 🚀 PLACEHOLDER: Upload to Google Drive / S3 / R2
         * -----------------------------------------------
         * This is where n8n or a Drive SDK upload should happen.
         *
         * Example (pseudo):
         * const driveLink = await uploadToDrive(outPath)
         */

        const uploadDriveLink = "PENDING_UPLOAD";

        /**
         * IMPORTANT:
         * Respond FAST with JSON ONLY
         */
        res.json({
          success: true,
          requestId,
          message: "Video rendered successfully",
          output: {
            filePath: outPath,
            sizeBytes: stats.size,
            driveLink: uploadDriveLink,
          },
        });

        /**
         * Cleanup (non-blocking)
         */
        setTimeout(() => {
          [videoPath, audioPath, captionsPath, outPath].forEach((p) => {
            if (p && fs.existsSync(p)) {
              try {
                fs.unlinkSync(p);
                console.log(`[${requestId}] Deleted ${p}`);
              } catch (e) {
                console.log(
                  `[${requestId}] Cleanup error for ${p}: ${e.message}`
                );
              }
            }
          });

          console.log(`[${requestId}] Cleanup complete`);
          console.log(`==============================\n`);
        }, 2000);
      });
    } catch (e) {
      console.error(`[${requestId}] SERVER ERROR`, e);
      res.status(500).json({
        success: false,
        requestId,
        error: "Server error",
        details: e.message,
      });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`FFmpeg Render API listening on port ${PORT}`)
);