import "reflect-metadata";
import { createServer } from "http";
import express from "express";
import { Server } from "colyseus";
import { ArenaRoom } from "./rooms/ArenaRoom";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, timestamp: Date.now() }));

const httpServer = createServer(app);

const gameServer = new Server({ server: httpServer });

gameServer.define("arena_room", ArenaRoom).filterBy(["mode"]);

gameServer.listen(PORT).then(() => {
  console.log(`[Colyseus] Game server running on port ${PORT}`);
  console.log(`[Colyseus] FastAPI URL: ${process.env.FASTAPI_URL || "http://localhost:8001"}`);
  console.log(`[Colyseus] Auth skip: ${process.env.SKIP_AUTH === "true" ? "YES (dev mode)" : "NO"}`);
});
