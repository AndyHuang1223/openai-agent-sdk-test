# OpenAI Agents SDK for TypeScript - Web UI 串流聊天範例

這是一個最小可執行範例，示範如何用 OpenAI Agents SDK 建立具備 UI 的聊天 agent，並在前端即時顯示串流輸出。

## 1) 安裝套件

```bash
npm install
```

## 2) 設定 API Key

```bash
cp .env.example .env
```

接著把 `.env` 裡的 `OPENAI_API_KEY` 改成你的金鑰，並設定 `MS_LEARN_MCP_URL`：

```dotenv
OPENAI_API_KEY=your_openai_api_key_here
MS_LEARN_MCP_URL=https://your-ms-learn-mcp-endpoint.example.com
```

## 3) 執行範例

```bash
npm run dev
```

開啟瀏覽器進入：

```text
http://localhost:3000
```

在 UI 中輸入訊息後，agent 回覆會以串流方式逐步顯示。

可先用健康檢查端點確認設定是否生效：

```bash
curl http://localhost:3000/api/health
```

你會看到：

- `openAiApiKeyConfigured`：`OPENAI_API_KEY` 是否已設定
- `msLearnMcpConfigured`：`MS_LEARN_MCP_URL` 是否已設定並啟用

## 程式入口

- `src/index.ts`：Node.js Web 伺服器與 `/api/chat` 串流端點
- `public/index.html`：聊天介面
- `public/app.js`：前端送出訊息與接收串流
- `public/styles.css`：頁面樣式

可自行調整：

- `instructions`：agent 角色設定
- `model`：模型選擇

## MS Learn MCP 與 C# 路由

此專案已支援在「C#/.NET 相關問題」時切換到含 MS Learn MCP 的 agent。

- MCP 連線型態：Streamable HTTP（讀取 `MS_LEARN_MCP_URL`）
- 路由方式：後端關鍵字判斷（例如 `c#`、`.net`、`linq`、`asp.net`）
- 行為限制：非 C# 問題不使用 MS Learn MCP
- 回答要求：C# 問題回覆末尾固定附「來源區塊」
  - 有來源時：
    - `【來源】`
    - `- MS Learn: <https://learn.microsoft.com/...>`
  - 無來源時：
    - `【來源】`
    - `- 無（本次未使用 MS Learn MCP）`
- 後端保險：若模型回覆缺少 `【來源】`，伺服器會在串流尾端自動補上「無來源」區塊
- 容錯降級：若 MCP 不可用或 C# MCP agent 請求失敗，會自動改用不含 MCP 的 C# fallback agent；若 fallback 也失敗才改用一般 agent（不中斷 API）

## Session Memory 運作說明（對照程式碼）

此專案的 session memory 是「以 `sessionId` 對應上一輪 `responseId`」，並在下一次呼叫時透過 `previousResponseId` 接續上下文。

### 對照重點

- `src/index.ts` 中的 `previousResponseBySession`：`Map<string, string>`，儲存 `sessionId -> lastResponseId`
- `POST /api/chat`：
  - 讀取 `sessionId`（若未提供則用 `default`）
  - 讀取 `previousResponseBySession.get(sessionId)` 並帶入 `run(..., { previousResponseId })`
  - 串流完成後用 `streamedResult.lastResponseId` 回寫到 `Map`
- `POST /api/reset`：收到 `sessionId` 後刪除該 key，清除該 session 記憶
- `public/app.js`：前端用 `localStorage` 保存 session id，重整頁面仍可延續同一段對話

### Mermaid 流程圖

```mermaid
flowchart TD
		A[前端輸入 message] --> B[讀取或建立 sessionId]
		B --> C[呼叫 POST /api/chat]
		C --> D[後端讀取 sessionId 對應的 previousResponseId]
		D --> E[run teacherAgent 並啟用 stream]
		E --> F[串流文字回前端]
		F --> G[完成後取得 lastResponseId]
		G --> H[寫回 session 記憶 Map]
		H --> I[同 session 下一則訊息可延續上下文]

		J[呼叫 POST /api/reset] --> K[刪除該 session 記憶]
```

### 注意事項

- 目前記憶是 in-memory（存在 Node 行程內），重啟服務後會消失
- 若要跨重啟保留，需把 `sessionId -> responseId` 改存到資料庫（如 Redis / Postgres）
