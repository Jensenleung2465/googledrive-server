[![none](https://github.com/Jensenleung2465/googledrive-server/blob/main/human/Screenshot%202026-04-11%20at%201.25.57%20AM.png?raw=true "none")](https://github.com/Jensenleung2465/googledrive-server/blob/main/human/Screenshot%202026-04-11%20at%201.25.57%20AM.png?raw=true "none")
# GoogleDrive Clone

Self-hosted Google Drive style file server built with Node.js and SQLite.

## Features

- File browsing, upload, download, delete
- SQLite metadata and logging
- AI chat assistant when `AI_MODE="True"`
- OpenRouter integration using `openrouter/free`
- GitHub private repo upload support
- Logs for file operations and AI activity

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file if needed and add:

```env
AI_MODE="True"
OPENROUTER_API_KEY="your-openrouter-key"
GITHUB_TOKEN="your-github-token"
HOST=0.0.0.0
PORT=3002
```

3. Run the server:

```bash
npm start
```

4. Open `http://localhost:3002`

## Notes

- AI mode is only active when `AI_MODE` is set to `True`.
- AI chat is read-only: the assistant can only suggest file organization, not modify files.
- GitHub upload uses the GitHub REST content API and will log failures for files that are too large.
- If using the GitHub upload form in bulk mode, the file count is limited to 100.
