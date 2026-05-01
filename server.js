const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8080;

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/projects", express.static(path.join(__dirname, "projects")));

function makeCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function projectDir(code) {
  return path.join(__dirname, "projects", code);
}

function clipsPath(code) {
  return path.join(projectDir(code), "clips.json");
}

function loadClips(code) {
  const dir = projectDir(code);
  const file = clipsPath(code);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2));
    return [];
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveClips(code, clips) {
  const dir = projectDir(code);
  const file = clipsPath(code);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(file, JSON.stringify(clips, null, 2));
}

function safeName(name) {
  return name.replace(/[^a-z0-9_-]/gi, "_");
}

app.post("/create-project", (req, res) => {
  const code = makeCode();
  fs.mkdirSync(projectDir(code), { recursive: true });
  saveClips(code, []);
  res.json({ code });
});

app.get("/project/:code/clips", (req, res) => {
  const code = req.params.code.toUpperCase();
  res.json({ clips: loadClips(code) });
});

app.post("/project/:code/upload-clip", upload.single("file"), (req, res) => {
  const code = req.params.code.toUpperCase();
  const type = req.body.type || "vocal";
  const name = safeName(req.body.name || `${type}_${Date.now()}`);

  const dir = projectDir(code);
  fs.mkdirSync(dir, { recursive: true });

  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  const ext = type === "beat" ? ".beat" : ".webm";
  const fileName = `${name}${ext}`;
  const finalPath = path.join(dir, fileName);

  fs.copyFileSync(req.file.path, finalPath);

  const clips = loadClips(code);

  if (type === "beat") {
    const oldBeatIndex = clips.findIndex(c => c.type === "beat");
    if (oldBeatIndex !== -1) {
      clips.splice(oldBeatIndex, 1);
    }
  }

  clips.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name,
    type,
    fileName,
    start: 0,
    volume: 1
  });

  saveClips(code, clips);

  res.json({ message: "Clip uploaded" });
});

app.post("/project/:code/update-clips", (req, res) => {
  const code = req.params.code.toUpperCase();
  const incomingClips = req.body.clips || [];
  const existingClips = loadClips(code);

  const updated = existingClips.map(oldClip => {
    const newClip = incomingClips.find(c => c.id === oldClip.id);

    if (!newClip) return oldClip;

    return {
      ...oldClip,
      start: Number(newClip.start || 0),
      volume: Number(newClip.volume || 1)
    };
  });

  saveClips(code, updated);

  res.json({ message: "Updated" });
});

app.delete("/project/:code/clip/:id", (req, res) => {
  const code = req.params.code.toUpperCase();
  const id = req.params.id;

  const dir = projectDir(code);
  let clips = loadClips(code);

  const clip = clips.find(c => c.id === id);

  if (!clip) return res.status(404).send("Clip not found");

  const filePath = path.join(dir, clip.fileName);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  clips = clips.filter(c => c.id !== id);
  saveClips(code, clips);

  res.json({ message: "Deleted" });
});

app.post("/project/:code/mix", (req, res) => {
  const code = req.params.code.toUpperCase();
  const dir = projectDir(code);
  const clips = loadClips(code);

  if (!clips.length) {
    return res.status(400).send("No clips");
  }

  const outputPath = path.join(dir, "final_mix.mp3");

  const inputs = clips
    .map(c => `-i "${path.join(dir, c.fileName)}"`)
    .join(" ");

  let filter = "";
  const labels = [];

  clips.forEach((clip, index) => {
    const delayMs = Math.round(Number(clip.start || 0) * 1000);
    const volume = Number(clip.volume || 1);
    const label = `a${index}`;

    labels.push(`[${label}]`);

    filter += `[${index}:a]volume=${volume},adelay=${delayMs}|${delayMs}[${label}];`;
  });

  filter += `${labels.join("")}amix=inputs=${clips.length}:duration=longest:normalize=0[mix]`;

  const command =
    `ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[mix]" "${outputPath}"`;

  exec(command, error => {
    if (error) {
      console.error(error);
      return res.status(500).send("Mix failed");
    }

    res.json({
      url: `/projects/${code}/final_mix.mp3`
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});