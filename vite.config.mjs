import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, mkdirSync, readFileSync, statSync, copyFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function existingDirectory(candidates) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory()) ?? candidates[0];
}

function resolvePromptWorkbenchData() {
  if (process.env.PROMPT_WORKBENCH_DATA_DIR) {
    return path.resolve(process.env.PROMPT_WORKBENCH_DATA_DIR);
  }
  if (process.env.PROMPT_WORKBENCH_DIR) {
    return path.resolve(process.env.PROMPT_WORKBENCH_DIR, "data");
  }
  return existingDirectory([
    path.resolve(
      "D:\\",
      "Stability Matrix",
      "Data",
      "Packages",
      "ComfyUI",
      "custom_nodes",
      "ComfyUI-Prompt-Workbench",
      "data",
    ),
    path.resolve(root, "..", "ComfyUI-Prompt-Workbench", "data"),
  ]);
}

const promptWorkbenchData = resolvePromptWorkbenchData();
const localDataRoute = "/prompt-workbench-data/";
const imageSaveRoute = `${localDataRoute}tag-set-images`;
const sourceImageRoute = `${localDataRoute}source-image`;
const imageDirectory = path.join(promptWorkbenchData, "tag-set-images");
const distImageDirectory = path.join(root, "dist", "client", "prompt-workbench-data", "tag-set-images");
const defaultDataFiles = ["tag_catalog.json", "tag_sets.json"];
const allowedDataDirectories = new Set([path.resolve(promptWorkbenchData)]);

function safeImageFileName(value) {
  let input = String(value || "");
  try {
    input = decodeURIComponent(input);
  } catch {
    // The value may already be decoded.
  }
  return path.basename(input).replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, "_").replace(/[. ]+$/u, "");
}

function dataDirectoryFromRequest(request) {
  const requestUrl = request.url ?? "";
  const parsedUrl = new URL(requestUrl, "http://localhost");
  const rawDirectory =
    parsedUrl.searchParams.get("dataDir") ||
    String(request.headers["x-prompt-workbench-data-dir"] ?? "");
  if (!rawDirectory) return path.resolve(promptWorkbenchData);
  const resolved = path.resolve(rawDirectory);
  if (!allowedDataDirectories.has(resolved)) {
    throw new Error("Requested Prompt Workbench data directory is not allowed for this server. Restart with PROMPT_WORKBENCH_DATA_DIR set to that data folder.");
  }
  return resolved;
}

function imageDirectoryFromRequest(request) {
  return path.join(dataDirectoryFromRequest(request), "tag-set-images");
}

function imageContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".webp") return "image/webp";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  return "application/octet-stream";
}

function blueskyPostParts(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "bsky.app") return null;
  const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/u);
  if (!match) return null;
  return { handle: decodeURIComponent(match[1]), rkey: decodeURIComponent(match[2]) };
}

async function resolveBlueskyHandle(handle) {
  if (handle.startsWith("did:")) return handle;
  const url = new URL("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle");
  url.searchParams.set("handle", handle);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Bluesky handle lookup failed: HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body?.did !== "string" || !body.did) throw new Error("Bluesky DID was not found");
  return body.did;
}

async function blueskyImageResponse(sourceUrl, imageIndex = 0) {
  const post = blueskyPostParts(sourceUrl);
  if (!post) return null;
  const repo = await resolveBlueskyHandle(post.handle);
  const recordUrl = new URL("https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord");
  recordUrl.searchParams.set("repo", repo);
  recordUrl.searchParams.set("collection", "app.bsky.feed.post");
  recordUrl.searchParams.set("rkey", post.rkey);
  const recordResponse = await fetch(recordUrl);
  if (!recordResponse.ok) throw new Error(`Bluesky post lookup failed: HTTP ${recordResponse.status}`);
  const record = await recordResponse.json();
  const images = Array.isArray(record?.value?.embed?.images) ? record.value.embed.images : [];
  const image = images[imageIndex]?.image;
  const cid = image?.ref?.["$link"];
  if (!cid) throw new Error(`Bluesky post image ${imageIndex + 1} was not found; ${images.length} image(s) available`);
  const extension = image?.mimeType === "image/png" ? "png" : "jpeg";
  const imageUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${repo}/${cid}@${extension}`;
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Bluesky image fetch failed: HTTP ${imageResponse.status}`);
  return imageResponse;
}

function promptWorkbenchDataPlugin() {
  const serveDataFile = (request, response, next) => {
    const requestUrl = request.url ?? "";
    if (!requestUrl.startsWith(localDataRoute)) {
      next();
      return;
    }
    if (requestUrl.startsWith(`${imageSaveRoute}/`)) {
      next();
      return;
    }
    const fileName = decodeURIComponent(requestUrl.slice(localDataRoute.length).split("?")[0] ?? "");
    if (!defaultDataFiles.includes(fileName)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    const filePath = path.join(promptWorkbenchData, fileName);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Prompt-Workbench-File-Path", encodeURIComponent(filePath));
    response.end(readFileSync(filePath));
  };

  const saveImageFile = (request, response, next) => {
    const requestUrl = request.url ?? "";
    if (request.method !== "POST" || requestUrl.split("?")[0] !== imageSaveRoute) {
      next();
      return;
    }
    const rawFileName = decodeURIComponent(String(request.headers["x-file-name"] ?? ""));
    const fileName = safeImageFileName(rawFileName);
    if (!fileName || !fileName.toLowerCase().endsWith(".webp")) {
      response.statusCode = 400;
      response.end("Invalid file name");
      return;
    }
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 8 * 1024 * 1024) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > 8 * 1024 * 1024) {
        response.statusCode = 413;
        response.end("Image is too large");
        return;
      }
      let targetImageDirectory;
      try {
        targetImageDirectory = imageDirectoryFromRequest(request);
      } catch (error) {
        response.statusCode = 400;
        response.end(error instanceof Error ? error.message : "Invalid data directory");
        return;
      }
      mkdirSync(targetImageDirectory, { recursive: true });
      const outputPath = path.join(targetImageDirectory, fileName);
      const buffer = Buffer.concat(chunks);
      writeFileSync(outputPath, buffer);
      if (existsSync(path.join(root, "dist", "client"))) {
        mkdirSync(distImageDirectory, { recursive: true });
        writeFileSync(path.join(distImageDirectory, fileName), buffer);
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ fileName, path: `${imageSaveRoute}/${fileName}` }));
    });
    request.on("error", () => {
      response.statusCode = 500;
      response.end("Failed to save image");
    });
  };

  const deleteImageFile = (request, response, next) => {
    const requestUrl = request.url ?? "";
    const parsedUrl = new URL(requestUrl, "http://localhost");
    if (request.method !== "DELETE" || parsedUrl.pathname !== imageSaveRoute) {
      next();
      return;
    }
    const fileName = safeImageFileName(parsedUrl.searchParams.get("file") ?? "");
    if (!fileName || !fileName.toLowerCase().endsWith(".webp")) {
      response.statusCode = 400;
      response.end("Invalid file name");
      return;
    }
    let targetImageDirectory;
    try {
      targetImageDirectory = imageDirectoryFromRequest(request);
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "Invalid data directory");
      return;
    }
    for (const directory of [targetImageDirectory, distImageDirectory]) {
      const filePath = path.join(directory, fileName);
      if (existsSync(filePath) && statSync(filePath).isFile()) unlinkSync(filePath);
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ fileName, deleted: true }));
  };

  const serveImageFile = (request, response, next) => {
    const requestUrl = request.url ?? "";
    const parsedUrl = new URL(requestUrl, "http://localhost");
    if (request.method !== "GET" || !parsedUrl.pathname.startsWith(`${imageSaveRoute}/`)) {
      next();
      return;
    }
    const fileName = safeImageFileName(parsedUrl.pathname.slice(`${imageSaveRoute}/`.length));
    if (!fileName) {
      response.statusCode = 400;
      response.end("Invalid file name");
      return;
    }
    let targetImageDirectory;
    try {
      targetImageDirectory = imageDirectoryFromRequest(request);
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : "Invalid data directory");
      return;
    }
    const filePath = path.join(targetImageDirectory, fileName);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", imageContentType(fileName));
    response.end(readFileSync(filePath));
  };

  const fetchSourceImage = (request, response, next) => {
    const requestUrl = request.url ?? "";
    const parsedUrl = new URL(requestUrl, "http://localhost");
    if (request.method !== "GET" || parsedUrl.pathname !== sourceImageRoute) {
      next();
      return;
    }
    const imageIndex = Math.max(0, Number.parseInt(parsedUrl.searchParams.get("image") ?? "1", 10) - 1 || 0);
    blueskyImageResponse(parsedUrl.searchParams.get("url") ?? "", imageIndex)
      .then(async (imageResponse) => {
        if (!imageResponse) {
          response.statusCode = 404;
          response.end("Unsupported source URL");
          return;
        }
        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        response.setHeader("Content-Type", imageResponse.headers.get("content-type") || "image/jpeg");
        response.setHeader("Cache-Control", "no-store");
        response.end(buffer);
      })
      .catch((error) => {
        response.statusCode = 502;
        response.end(error instanceof Error ? error.message : "Failed to fetch source image");
      });
  };

  const copyDataFiles = () => {
    const targetDirectory = path.join(root, "dist", "client", localDataRoute.replace(/^\/|\/$/gu, ""));
    mkdirSync(targetDirectory, { recursive: true });
    for (const fileName of defaultDataFiles) {
      const sourcePath = path.join(promptWorkbenchData, fileName);
      if (existsSync(sourcePath) && statSync(sourcePath).isFile()) {
        copyFileSync(sourcePath, path.join(targetDirectory, fileName));
      }
    }
  };

  return {
    name: "prompt-workbench-default-data",
    configureServer(server) {
      server.middlewares.use(fetchSourceImage);
      server.middlewares.use(deleteImageFile);
      server.middlewares.use(saveImageFile);
      server.middlewares.use(serveImageFile);
      server.middlewares.use(serveDataFile);
    },
    configurePreviewServer(server) {
      server.middlewares.use(fetchSourceImage);
      server.middlewares.use(deleteImageFile);
      server.middlewares.use(saveImageFile);
      server.middlewares.use(serveImageFile);
      server.middlewares.use(serveDataFile);
    },
    closeBundle() {
      copyDataFiles();
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react(), promptWorkbenchDataPlugin()],
});
