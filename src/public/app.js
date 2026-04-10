const currentState = {
  path: "",
  items: [],
  aiMode: false,
};

const fileRows = document.getElementById("fileRows");
const breadcrumbs = document.getElementById("breadcrumbs");
const searchInput = document.getElementById("searchInput");
const uploadButton = document.getElementById("uploadButton");
const uploadInput = document.getElementById("uploadInput");
const parentPathInput = document.getElementById("parentPath");
const githubUploadButton = document.getElementById("githubUploadButton");
const githubStatus = document.getElementById("githubStatus");
const logButtons = document.querySelectorAll(".log-button");
const logOutput = document.getElementById("logOutput");
const aiPanel = document.getElementById("aiPanel");
const aiMessage = document.getElementById("aiMessage");
const aiSend = document.getElementById("aiSend");
const chatWindow = document.getElementById("chatWindow");

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

function renderBreadcrumbs(path) {
  const parts = path ? path.split("/") : [];
  breadcrumbs.innerHTML = "";
  const rootButton = document.createElement("button");
  rootButton.textContent = "Home";
  rootButton.onclick = () => loadFiles("");
  breadcrumbs.appendChild(rootButton);
  let build = "";
  parts.forEach((segment, index) => {
    build = build ? `${build}/${segment}` : segment;
    const separator = document.createElement("span");
    separator.textContent = ">";
    breadcrumbs.appendChild(separator);
    const button = document.createElement("button");
    button.textContent = segment;
    button.onclick = () => loadFiles(build);
    breadcrumbs.appendChild(button);
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

function renderFiles(items) {
  fileRows.innerHTML = "";
  items.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.type === "folder" ? "📁" : "📄"} ${item.name}</td>
      <td>${item.type}</td>
      <td>${item.type === "folder" ? "—" : formatBytes(item.size)}</td>
      <td>${new Date(item.modifiedAt).toLocaleString()}</td>
      <td class="actions"></td>
    `;
    const actions = row.querySelector(".actions");
    if (item.type === "folder") {
      const open = document.createElement("button");
      open.className = "btn btn-secondary";
      open.textContent = "Open";
      open.onclick = () => loadFiles(item.path);
      actions.appendChild(open);
    } else {
      const download = document.createElement("button");
      download.className = "btn btn-secondary";
      download.textContent = "Download";
      download.onclick = () => {
        window.location.href = `/api/download?path=${encodeURIComponent(item.path)}`;
      };
      actions.appendChild(download);
    }
    const remove = document.createElement("button");
    remove.className = "btn btn-danger";
    remove.textContent = "Delete";
    remove.onclick = async () => {
      if (!confirm(`Delete ${item.name}?`)) return;
      await fetchJson("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path }),
      });
      loadFiles(currentState.path);
    };
    actions.appendChild(remove);
    fileRows.appendChild(row);
  });
}

async function loadFiles(path = "") {
  const query = new URLSearchParams({ path }).toString();
  const result = await fetchJson(`/api/files?${query}`);
  currentState.path = result.path;
  currentState.items = result.items;
  renderBreadcrumbs(result.path);
  renderFiles(result.items);
}

uploadButton.addEventListener("click", async () => {
  const files = uploadInput.files;
  const parentPath = parentPathInput.value.trim();
  if (!files.length) {
    alert("Select at least one file to upload.");
    return;
  }
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  if (parentPath) formData.append("parentPath", parentPath);
  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || "Upload failed.");
    return;
  }
  uploadInput.value = "";
  parentPathInput.value = "";
  loadFiles(currentState.path);
});

githubUploadButton.addEventListener("click", async () => {
  const owner = document.getElementById("repoOwner").value.trim();
  const repo = document.getElementById("repoName").value.trim();
  const branch = document.getElementById("branchName").value.trim() || "main";
  const mode = document.getElementById("uploadMode").value;
  if (!owner || !repo) {
    alert("Enter GitHub owner and repository name.");
    return;
  }
  githubStatus.textContent = "Uploading...";
  try {
    const result = await fetchJson("/api/github-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoOwner: owner, repoName: repo, branch, mode }),
    });
    githubStatus.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    githubStatus.textContent = `Upload failed: ${error.message}`;
  }
});

logButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const logFile = button.dataset.log;
    const result = await fetchJson(`/api/logs?file=${encodeURIComponent(logFile)}`);
    logOutput.textContent = result.content;
  });
});

aiSend.addEventListener("click", async () => {
  const message = aiMessage.value.trim();
  if (!message) return;
  chatWindow.innerHTML += `<div class="chat-entry"><strong>You</strong><div class="text">${message}</div></div>`;
  aiMessage.value = "";
  const result = await fetchJson("/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  chatWindow.innerHTML += `<div class="chat-entry"><strong>Assistant</strong><div class="text">${result.response}</div></div>`;
  chatWindow.scrollTop = chatWindow.scrollHeight;
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = currentState.items.filter((item) => item.name.toLowerCase().includes(query));
  renderFiles(filtered);
});

(async function init() {
  const config = await fetchJson("/api/config");
  if (config.aiMode) {
    aiPanel.classList.remove("hidden");
    currentState.aiMode = true;
  }
  await loadFiles("");
})();
