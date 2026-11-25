const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const ROOT = __dirname;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "BONAGO" }));

app.use(express.static(ROOT, {
  index: "index.html",
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (path.basename(filePath) === "index.html") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }
}));

app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BONAGO web service listening on 0.0.0.0:${PORT}`);
});
