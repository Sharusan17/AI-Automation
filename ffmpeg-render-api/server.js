const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();

// ✅ Keep uploads in /tmp (Render allows this)
const upload = multer({
  dest: "/tmp",
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB safeguard
  },
});

// ✅ Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "FFmpeg Render API is running" });
});

// ✅ Extra health endpoint (handy for monitoring)
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * POST /render
 * multipart/form-data:
 * - video: mp4 (background video)
 * - audio: mp3 (voice)
 * - captions: srt (optional)
 *
 * returns: final.mp4
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
      console.log(`[${requestId}] Incoming POST /render`);
      console.log(`[${requestId}] Time: ${new Date().toISOString()}`);

      // ✅ Log what keys arrived
      console.log(
        `[${requestId}] req.files keys:`,
        Object.keys(req.files || {})
      );
      console.log(`[${requestId}] req.body:`, req.body || {});

      // ✅ Detailed file logs (video/audio/captions)
      const logFile = (label, fileObj) => {
        if (!fileObj) {
          console.log(`[${requestId}] ${label}: NOT PROVIDED`);
          return;
        }
        console.log(`[${requestId}] ${label}:`, {
          fieldname: fileObj.fieldname,
          originalname: fileObj.originalname,
          mimetype: fileObj.mimetype,
          size: fileObj.size,
          path: fileObj.path,
        });
      };

      logFile("VIDEO", req.files?.video?.[0]);
      logFile("AUDIO", req.files?.audio?.[0]);
      logFile("CAPTIONS", req.files?.captions?.[0]);

      // ✅ Validate required uploads
      if (!req.files?.video?.[0] || !req.files?.audio?.[0]) {
        console.log(
          `[${requestId}] ERROR: Missing required files (video/audio)`
        );
        return res.status(400).json({
          error: "Missing required files: video and audio",
          requestId,
          receivedFiles: Object.keys(req.files || {}),
        });
      }

      const videoPath = req.files.video[0].path;
      const audioPath = req.files.audio[0].path;
      const captionsPath = req.files?.captions?.[0]?.path || null;

      const outPath = path.join("/tmp", `final_${Date.now()}.mp4`);

      console.log(`[${requestId}] videoPath: ${videoPath}`);
      console.log(`[${requestId}] audioPath: ${audioPath}`);
      console.log(`[${requestId}] captionsPath: ${captionsPath || "(none)"}`);
      console.log(`[${requestId}] outPath: ${outPath}`);

      // ✅ Build filter: TikTok 9:16 crop + captions if provided
      let filter =
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

      if (captionsPath) {
        // Burn captions with readable style (bottom center)
        filter += `,subtitles=${captionsPath}:force_style='Fontsize=48,Outline=2,BorderStyle=1,Shadow=0,Alignment=2,MarginV=80'`;
      }

      console.log(`[${requestId}] FFmpeg filter: ${filter}`);

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

      execFile("ffmpeg", args, (err, stdout, stderr) => {
        const durationMs = Date.now() - start;

        // ✅ Always log FFmpeg output (trim to avoid huge logs)
        if (stdout) {
          console.log(
            `[${requestId}] FFmpeg stdout (first 2000 chars):\n${stdout
              .toString()
              .slice(0, 2000)}`
          );
        }

        if (stderr) {
          console.log(
            `[${requestId}] FFmpeg stderr (first 4000 chars):\n${stderr
              .toString()
              .slice(0, 4000)}`
          );
        }

        console.log(
          `[${requestId}] FFmpeg completed in ${durationMs}ms`
        );

        if (err) {
          console.error(`[${requestId}] FFmpeg FAILED:`, err);
          return res.status(500).json({
            error: "FFmpeg failed",
            requestId,
            details: stderr?.toString()?.slice(0, 2000),
          });
        }

        // ✅ Ensure output exists
        if (!fs.existsSync(outPath)) {
          console.error(`[${requestId}] Output file not found: ${outPath}`);
          return res.status(500).json({
            error: "Output file not generated",
            requestId,
          });
        }

        const finalStats = fs.statSync(outPath);
        console.log(
          `[${requestId}] Output file size: ${finalStats.size} bytes`
        );

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=final.mp4"
        );
        res.setHeader("X-Request-Id", requestId);

        const stream = fs.createReadStream(outPath);
        stream.pipe(res);

        stream.on("close", () => {
          console.log(`[${requestId}] Response stream closed. Cleaning up...`);

          [videoPath, audioPath, captionsPath, outPath].forEach((p) => {
            if (p && fs.existsSync(p)) {
              try {
                fs.unlinkSync(p);
                console.log(`[${requestId}] Deleted: ${p}`);
              } catch (e) {
                console.log(
                  `[${requestId}] Failed to delete ${p}: ${e.message}`
                );
              }
            }
          });

          console.log(`[${requestId}] Cleanup complete.`);
          console.log(`==============================\n`);
        });

        stream.on("error", (e) => {
          console.error(`[${requestId}] Stream error: ${e.message}`);
        });
      });
    } catch (e) {
      console.error(`[${requestId}] Server error:`, e);
      return res.status(500).json({
        error: "Server error",
        requestId,
        details: e.message,
      });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Render API listening on port ${PORT}`));
