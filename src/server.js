const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3002", 10);
const HOST = process.env.HOST || "0.0.0.0";
const AI_MODE = process.env.AI_MODE === "True" || process.env.AI_MODE === "true";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.AI_CLINE_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const UPLOAD_ROOT = path.join(__dirname, "uploads");
const LOG_ROOT = path.join(__dirname, "logs");
const DATA_ROOT = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_ROOT, "app.db");

[UPLOAD_ROOT, LOG_ROOT, DATA_ROOT].forEach((folder) => {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
});

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS file_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE,
    name TEXT,
    mime TEXT,
    size INTEGER,
    created_at TEXT,
    updated_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    subject TEXT,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT,
    message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

function safePath(relativePath) {
  const normalized = (relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error("Invalid path");
  }
  const result = path.resolve(UPLOAD_ROOT, normalized);
  if (!result.startsWith(UPLOAD_ROOT)) {
    throw new Error("Invalid path");
  }
  return result;
}

function logText(file, message) {
  const text = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(path.join(LOG_ROOT, file), text, { encoding: "utf8" });
}

function logOperation(type, subject, details = "") {
  logText("fileops.log", `${type} ${subject} ${details}`);
  db.run("INSERT INTO logs (type, subject, details) VALUES (?, ?, ?)", [type, subject, details]);
}

function logAiChat(role, message) {
  logText("ai_chat.log", `${role}: ${message}`);
  db.run("INSERT INTO chat_logs (role, message) VALUES (?, ?)", [role, message]);
}

function logAiRead(message) {
  logText("ai_read.log", message);
}

function logAiDid(message) {
  logText("ai_did.log", message);
}

function listDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    const stats = fs.statSync(fullPath);
    return {
      name: entry.name,
      path: path.relative(UPLOAD_ROOT, fullPath).split(path.sep).join("/"),
      type: entry.isDirectory() ? "folder" : "file",
      size: entry.isDirectory() ? 0 : stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      const parentPath = req.body.parentPath || "";
      const fullPath = safePath(parentPath);
      fs.mkdirSync(fullPath, { recursive: true });
      cb(null, fullPath);
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  res.json({ aiMode: AI_MODE, githubEnabled: !!GITHUB_TOKEN || !!req.headers["x-github-token"] });
});

app.get("/api/files", (req, res) => {
  try {
    const folder = safePath(req.query.path || "");
    const result = listDirectory(folder);
    res.json({ path: req.query.path || "", items: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/upload", upload.array("files", 20), (req, res) => {
  try {
    const parentPath = req.body.parentPath || "";
    const results = req.files.map((file) => {
      const filePath = path.relative(UPLOAD_ROOT, file.path).split(path.sep).join("/");
      db.run(
        `INSERT OR REPLACE INTO file_meta (file_path, name, mime, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [filePath, file.originalname, file.mimetype, file.size, new Date().toISOString(), new Date().toISOString()]
      );
      logOperation("UPLOAD", filePath, `size=${file.size}`);
      return { name: file.originalname, path: filePath, size: file.size };
    });
    res.json({ success: true, uploaded: results, parentPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/download", (req, res) => {
  try {
    const filePath = safePath(req.query.path || "");
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: "File not found" });
    }
    res.download(filePath);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/delete", (req, res) => {
  try {
    const targetPath = safePath(req.body.path || "");
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: "Path not found" });
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    logOperation("DELETE", path.relative(UPLOAD_ROOT, targetPath).split(path.sep).join("/"));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function openRouterChat(message) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key missing. Set OPENROUTER_API_KEY or AI_CLINE_KEY in .env.");
  }

  const systemPrompt = `You are a read-only AI assistant for a self-hosted file server. You may help the user tidy and organize files by suggesting folder structure, naming, and cleanup, but you must never edit, delete, write, add, or execute files. Explain what the user can do next without claiming to have performed the actions. Use only the information the user shares and your allowed file view context.`;
  const payload = {
    model: "openrouter/free",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ],
    max_tokens: 512,
  };

  const response = await fetch("https://openrouter.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error: ${text}`);
  }
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content || "No response from AI.";
  return content;
}

app.post("/api/ai-chat", async (req, res) => {
  if (!AI_MODE) {
    return res.status(403).json({ error: "AI mode is disabled. Set AI_MODE=\"True\" in .env." });
  }
  try {
    const message = (req.body.message || "").toString();
    if (!message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }
    logAiRead(`User: ${message}`);
    const reply = await openRouterChat(message);
    logAiChat("user", message);
    logAiChat("assistant", reply);
    logAiDid(`Suggested: ${reply.substring(0, 250)}`);
    res.json({ response: reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function collectUploadFiles(basePath, relative = "") {
  const current = path.join(basePath, relative);
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectUploadFiles(basePath, entryRelative));
    } else if (entry.isFile()) {
      files.push({ path: entryRelative.split(path.sep).join("/"), absolute: entryPath, size: fs.statSync(entryPath).size });
    }
  }
  return files;
}

async function getGithubFileSha(owner, repo, branch, repoPath, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "googledrive-server"
    },
  });
  if (response.status === 200) {
    const json = await response.json();
    return json.sha;
  }
  return null;
}

async function uploadGithubFile(owner, repo, branch, token, repoPath, fileContent, sha = null) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}`;
  const body = {
    message: `Upload ${repoPath} from self-hosted file server`,
    content: fileContent,
    branch,
  };
  if (sha) body.sha = sha;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "googledrive-server",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response;
}

app.post("/api/github-upload", async (req, res) => {
  const token = req.body.token || GITHUB_TOKEN;
  const owner = req.body.repoOwner;
  const repo = req.body.repoName;
  const branch = req.body.branch || "main";
  const mode = req.body.mode || "one_by_one";

  if (!token || !owner || !repo) {
    return res.status(400).json({ error: "repoOwner, repoName and GitHub token are required." });
  }

  try {
    const files = collectUploadFiles(UPLOAD_ROOT, "");
    const totalSize = files.reduce((sum, entry) => sum + entry.size, 0);
    if (mode === "bulk" && files.length > 100) {
      const msg = `Bulk upload blocked; ${files.length} files exceeds 100-file limit.`;
      logOperation("GITHUB_UPLOAD_BLOCK", `${owner}/${repo}`, msg);
      return res.status(400).json({ error: msg });
    }
    const tooLarge = files.filter((f) => f.size > 20 * 1024 * 1024);
    if (tooLarge.length > 0) {
      const msg = `Upload blocked because file ${tooLarge[0].path} is too large (>20MB).`;
      logOperation("GITHUB_UPLOAD_BLOCK", `${owner}/${repo}`, msg);
      return res.status(400).json({ error: msg });
    }
    if (mode === "bulk" && totalSize > 200 * 1024 * 1024) {
      const msg = `Bulk upload blocked because the total upload size ${Math.round(totalSize / 1024 / 1024)}MB is too large.`;
      logOperation("GITHUB_UPLOAD_BLOCK", `${owner}/${repo}`, msg);
      return res.status(400).json({ error: msg });
    }

    const uploadResults = [];
    for (const file of files) {
      const content = fs.readFileSync(file.absolute);
      const encoded = content.toString("base64");
      const repoPath = file.path;
      const sha = await getGithubFileSha(owner, repo, branch, repoPath, token);
      const response = await uploadGithubFile(owner, repo, branch, token, repoPath, encoded, sha);
      const result = await response.json();
      if (!response.ok) {
        logOperation("GITHUB_UPLOAD_ERROR", repoPath, JSON.stringify(result).slice(0, 200));
        uploadResults.push({ path: repoPath, success: false, error: result.message || "GitHub API error" });
      } else {
        logOperation("GITHUB_UPLOAD", repoPath, `repo=${owner}/${repo} branch=${branch}`);
        uploadResults.push({ path: repoPath, success: true });
      }
    }
    res.json({ success: true, count: uploadResults.length, files: uploadResults });
  } catch (error) {
    logOperation("GITHUB_UPLOAD_ERROR", `${owner}/${repo}`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/logs", (req, res) => {
  try {
    const file = req.query.file || "fileops.log";
    const allowed = ["fileops.log", "ai_chat.log", "ai_read.log", "ai_did.log"];
    if (!allowed.includes(file)) {
      return res.status(400).json({ error: "Invalid log file." });
    }
    const logPath = path.join(LOG_ROOT, file);
    if (!fs.existsSync(logPath)) {
      return res.json({ content: "" });
    }
    res.json({ content: fs.readFileSync(logPath, "utf8") });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Google Drive clone server running at http://${HOST}:${PORT}`);
  console.log(`AI mode: ${AI_MODE ? "enabled" : "disabled"}`);
});
