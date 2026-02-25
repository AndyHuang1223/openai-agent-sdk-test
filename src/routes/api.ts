import { Router } from "express";
import { ChatService } from "../services/chatService.js";

type ChatBody = {
  message?: unknown;
  sessionId?: unknown;
};

type ResetBody = {
  sessionId?: unknown;
};

export function createApiRouter(chatService: ChatService): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.set("Cache-Control", "no-cache");
    response.status(200).json(chatService.getHealth());
  });

  router.post("/chat", async (request, response, next) => {
    try {
      const payload = (request.body ?? {}) as ChatBody;
      const message =
        typeof payload.message === "string" ? payload.message.trim() : "";
      const sessionId =
        typeof payload.sessionId === "string" ? payload.sessionId : "default";

      if (!message) {
        response.status(400).json({ error: "message 不可為空" });
        return;
      }

      response.set({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.status(200);

      await chatService.streamChat({
        message,
        sessionId,
        onChunk: (chunk) => {
          response.write(chunk);
        },
      });

      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知錯誤";
      if (response.headersSent) {
        if (!response.writableEnded) {
          response.end(`\n\n[server-error] ${message}`);
        }
        return;
      }
      next(error);
    }
  });

  router.post("/reset", (request, response) => {
    const payload = (request.body ?? {}) as ResetBody;
    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : "";

    chatService.resetSession(sessionId);
    response.status(200).json({ ok: true });
  });

  return router;
}
