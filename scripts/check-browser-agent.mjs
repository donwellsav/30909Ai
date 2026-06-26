import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const settingsPath = path.join(root, "data", "settings.json");
const chatPath = path.join(root, "data", "chat-history.json");
const oldSettings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : null;
const oldChat = fs.existsSync(chatPath) ? fs.readFileSync(chatPath, "utf8") : null;
let calls = 0;
const seenResults = new Set();

function restore() {
  if (oldSettings === null) fs.rmSync(settingsPath, { force: true });
  else fs.writeFileSync(settingsPath, oldSettings);
  if (oldChat === null) fs.rmSync(chatPath, { force: true });
  else fs.writeFileSync(chatPath, oldChat);
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/agent-browser-test") {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html>
      <html>
        <head><title>Browser Agent Test</title></head>
        <body>
          <main>
            <h1>Browser Agent Test</h1>
            <input name="q" aria-label="Query" />
            <button onclick="document.getElementById('state').textContent = 'Clicked ' + document.querySelector('[name=q]').value">Run</button>
            <p id="state">Waiting</p>
          </main>
        </body>
      </html>`);
    return;
  }

  if (request.method === "GET" && request.url === "/v1/models") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "mock-browser-model" }] }));
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const json = JSON.parse(body);
      for (const message of json.messages) {
        const content = String(message.content);
        if (content.includes("Browser action result: open 127.0.0.1:19091/agent-browser-test")) seenResults.add("open");
        if (content.includes("Browser action result: type input[name=\"q\"]")) seenResults.add("type");
        if (content.includes("Browser action result: click text=Run")) seenResults.add("click");
      }
      const replies = [
        { browser_action: { action: "navigate", url: "127.0.0.1:19091/agent-browser-test" } },
        { browser_action: { action: "input", target: "input[name=\"q\"]", value: "local test" } },
        { browser_action: { action: "click", label: "Run" } },
        "The browser test page now shows the clicked local test state.",
      ];
      const reply = replies[Math.min(calls, replies.length - 1)];
      const content = typeof reply === "string" ? reply : JSON.stringify(reply);
      calls += 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    return;
  }

  response.statusCode = 404;
  response.end("not found");
});

server.listen(19091, "127.0.0.1", async () => {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const settings = oldSettings ? JSON.parse(oldSettings) : {};
    fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, endpoint: "http://127.0.0.1:19091/v1", model: "mock-browser-model" }, null, 2));
    fs.writeFileSync(chatPath, "[]");

    const response = await fetch("http://localhost:3090/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Open example.com and tell me what happened.", browserContext: {} }),
    });
    const json = await response.json();
    const ok = response.ok
      && calls === 4
      && seenResults.has("open")
      && seenResults.has("type")
      && seenResults.has("click")
      && json.browserState?.title === "Browser Agent Test"
      && json.browserState?.text?.includes("Clicked local test")
      && json.browserActions?.length === 3
      && json.browserActions.every((action) => action.status === "ok");

    console.log(JSON.stringify({
      ok,
      calls,
      seenResults: [...seenResults],
      browserTitle: json.browserState?.title,
      browserText: json.browserState?.text,
      actionStatuses: json.browserActions?.map((action) => action.status),
    }, null, 2));

    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    restore();
    server.close();
  }
});
