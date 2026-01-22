const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({ dest: "/tmp" });

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "FFmpeg Render API is running" });
});

/**
 * POST /render
 * form-data:
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
    { name: "captions", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      if (!req.files?.video?.[0] || !req.files?.audio?.[0]) {
        return res.status(400).json({
          error: "Missing required files: video and audio"
        });
      }

      const videoPath = req.files.video[0].path;
      const audioPath = req.files.audio[0].path;
      const captionsPath = req.files?.captions?.[0]?.path || null;

      const outPath = path.join("/tmp", `final_${Date.now()}.mp4`);

      // Build filter
      // TikTok 9:16 crop + subtitles if provided
      let filter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

      if (captionsPath) {
        // Burn captions with readable style
        filter += `,subtitles=${captionsPath}:force_style='Fontsize=48,Outline=2,BorderStyle=1,Shadow=0,Alignment=2,MarginV=80'`;
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
        outPath
      ];

      execFile("ffmpeg", args, (err, stdout, stderr) => {
        if (err) {
          console.error("FFmpeg error:", stderr);
          return res.status(500).json({
            error: "FFmpeg failed",
            details: stderr?.toString()?.slice(0, 2000)
          });
        }

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", "attachment; filename=final.mp4");

        const stream = fs.createReadStream(outPath);
        stream.pipe(res);

        // cleanup
        stream.on("close", () => {
          [videoPath, audioPath, captionsPath, outPath].forEach((p) => {
            if (p && fs.existsSync(p)) fs.unlinkSync(p);
          });
        });
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Server error", details: e.message });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Render API listening on port ${PORT}`));