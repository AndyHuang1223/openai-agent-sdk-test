import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { join } from "node:path";
import { createApiRouter } from "./routes/api.js";
import { ChatService } from "./services/chatService.js";

const PUBLIC_DIR = join(process.cwd(), "public");

export function createApp(chatService = new ChatService()) {
  const app = express();

  app.use((request, response, next) => {
    if (!process.env.OPENAI_API_KEY) {
      response
        .status(500)
        .json({ error: "缺少 OPENAI_API_KEY，請先設定 .env" });
      return;
    }
    next();
  });

  app.use(express.json());
  app.use("/api", createApiRouter(chatService));

  app.use(express.static(PUBLIC_DIR));

  app.get("/", (_request, response) => {
    response.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  app.use((_request, response) => {
    response.status(404).type("text/plain; charset=utf-8").send("Not found");
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (response.headersSent) {
        next(error);
        return;
      }

      const message = error instanceof Error ? error.message : "未知錯誤";
      response.status(500).json({ error: message });
    },
  );

  return app;
}
