# Flask + MCP 中文法律 AI 项目

这是一个前后端分离的示例项目：

- `backend/`：Flask API，负责调用 DashScope OpenAI 兼容接口，并把 MCP 工具接入到模型 function calling 流程里
- `frontend/`：React + Vite 单页聊天界面，目前只有一个现代化 AI 对话窗口

## 项目结构

```text
QG/
├─ backend/
│  ├─ app/
│  │  ├─ services/
│  │  ├─ __init__.py
│  │  ├─ config.py
│  │  └─ routes.py
│  ├─ .env.example
│  ├─ requirements.txt
│  └─ run.py
├─ frontend/
│  ├─ src/
│  ├─ .env.example
│  ├─ package.json
│  ├─ vite.config.js
│  └─ index.html
└─ README.md
```

## 后端能力

后端默认已经按你的要求配置了 MCP server：

```json
{
  "command": "npx",
  "args": ["-y", "@ansvar/chinese-law-mcp"]
}
```

Flask `/api/chat` 接口工作流如下：

1. 接收前端问题与上下文
2. 通过 MCP session 获取可用工具列表
3. 将 MCP tools 转成 DashScope `chat.completions` 可调用的 function tools
4. 如果模型发起 tool call，则由后端执行 MCP 工具并把结果回填给模型
5. 返回最终中文答案给前端

## 环境变量

在 `backend/.env` 中配置：

```env
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=你的真实 Key
LLM_CHAT_MODEL=qwen-plus
MCP_SERVER_COMMAND=npx
MCP_SERVER_ARGS_JSON=["-y", "@ansvar/chinese-law-mcp"]
```

在 `frontend/.env` 中配置：

```env
VITE_API_BASE_URL=http://127.0.0.1:5000/api
```

## 启动方式

### 1. 安装 Python

当前这台机器的终端里还没有可直接调用的 Python，所以需要先安装 Python 3.11+，并确保命令行可用。

启动后端
cd C:\Users\14490\Desktop\QG\backend
.venv\Scripts\activate
py run.py
启动前端
cd C:\Users\14490\Desktop\QG\frontend
npm.cmd run dev
暂时部署
ngrok.exe http 5173

## 默认接口

- 前端开发地址：`http://127.0.0.1:5173`
- 后端接口地址：`http://127.0.0.1:5000/api`
- 健康检查：`GET /api/health`
- 聊天接口：`POST /api/chat`

## 聊天接口示例

```json
{
  "message": "劳动合同未签订，公司会承担什么责任？",
  "history": [
    {
      "role": "assistant",
      "content": "请输入你的法律问题。"
    }
  ]
}
```

## 💰 费用与安全说明

- ✅ **本项目本地开发完全免费**：文件读取、代码分析、终端命令均由 Cursor 本地智能体执行，**不调用任何外部大模型 API**，不产生任何费用。
- ⚠️ **真实计费仅发生在后端调用时**：当 `backend/app/routes.py` 中的 `/api/chat` 接口向 `https://dashscope.aliyuncs.com/...` 发起请求时，才按 [DashScope 官方定价](https://help.aliyun.com/zh/dashscope/developer-reference/price-overview) 计费（`qwen-plus-us`：¥0.015/1K input tokens + ¥0.030/1K output tokens）。
- 💡 **典型法律问答成本参考**：  
`提问：“《劳动合同法》第82条双倍工资如何计算？”`  
→ 输入约 25 tokens + 输出约 420 tokens → **总成本 ≈ ¥0.013**（约 1.3 分钱）。
- 🔒 **安全实践**：  
  - `.env` 文件已加入 `.gitignore`，请勿提交；  
  - 生产环境务必使用环境变量注入，而非硬编码；  
  - 建议为 DashScope Key 设置用量告警（阿里云控制台 → DashScope → 配额管理）。

## 🧾 法律专业能力（由 `@ansvar/chinese-law-mcp` 提供）

本系统不是通用聊天机器人，而是深度集成中国法律知识图谱的专用助手，支持以下能力：

- ✅ 实时检索《中华人民共和国宪法》《民法典》《刑法》等全文及最新修订版  
- ✅ 关联司法解释、指导性案例、最高人民法院公报案例  
- ✅ 解析法律条文适用场景（如：“第X条在劳动争议中的适用条件”）  
- ✅ 生成符合《律师执业规范》的法律意见书框架  
- ✅ 比对不同地区法院对同类案件的裁判尺度（需 Farui 平台授权）
- ✅ **Contract Review**：支持 PDF 合同上传、AI 驱动的风险条款识别（如违约责任、管辖条款）、风险评分（0–100）及修订建议生成，输出符合《律师执业规范》的审查报告。

> 💡 提示：所有法律工具调用均通过 MCP 协议完成，前端无需感知底层实现，保障合规与可审计性。

## 🚀 快速体验（Windows 一键启动）

确保已安装：

- Python 3.11+（运行 `where python` 验证）  
- Node.js 20+（运行 `where npm` 验证）  
- Git（运行 `where git` 验证）

```powershell
# 1. 启动后端（自动创建虚拟环境）
cd C:\Users\14490\Desktop\QG\backend
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
py run.py

# 2. 启动前端（自动安装依赖）
cd C:\Users\14490\Desktop\QG\frontend
npm install
npm run dev

# ✅ 访问 http://127.0.0.1:5173 —— 你的法律 AI 助手已就绪！
```

## 📜 许可证

Apache License 2.0 —— 可自由用于商业法律科技产品。