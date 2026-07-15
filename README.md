# 智能日程表 Agent

跨平台智能日程管理 Agent 应用，基于 CodeBuddy Agent SDK 构建，支持自然语言创建日程、智能排期和跨平台提醒。

## 功能特性

### 🤖 AI 智能调度
- **自然语言解析**：支持口语化指令，自动提取任务、时间、地点
- **智能排期**：根据任务优先级和耗时自动规划时间
- **智能追问**：信息不完整时主动询问关键要素

### 📅 日程管理
- 按日/周视图查看日程
- 支持任务分类（工作、生活、出行、社交、健康等）
- 优先级设置（高、中、低）
- 标记完成/未完成状态

### 🔔 提醒通知
- 自定义提醒时间
- 系统通知支持
- 桌面弹窗提醒

### 💻 跨平台支持
- **Web 端**：浏览器访问
- **桌面端**：Windows/macOS/Linux
- 数据实时同步

## 快速开始

### 环境要求
- Node.js 18+
- npm 或 yarn
- CodeBuddy API Key

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制环境变量模板并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，添加你的 CodeBuddy API Key：

```
CODEBUDDY_API_KEY=your_api_key_here
```

### 开发模式

**Web 开发模式（浏览器访问）**

```bash
npm run dev
```

访问 http://localhost:5173

**Electron 桌面应用开发模式**

```bash
npm run dev:electron
```

### 构建

**构建 Web 应用**

```bash
npm run build:client
```

**构建 Electron 应用**

```bash
npm run electron:build
```

构建完成后，可执行文件位于 `release` 目录。

## 使用说明

### 自然语言创建日程

在对话框中输入自然语言指令，例如：

```
明天上午9点去开会
```

```
这周六下午3点约了朋友在咖啡厅见面
```

```
安排下周三去出差，需要准备什么？
```

### 查看和管理日程

点击左侧边栏的"日程表"按钮，可以：
- 按日查看当天的所有日程
- 切换不同日期查看
- 点击任务标记完成
- 删除不需要的日程

## 项目结构

```
smart-schedule-agent/
├── electron/           # Electron 主进程代码
│   ├── main.ts        # 主进程入口
│   └── preload.ts     # Preload 脚本
├── server/            # 后端服务
│   ├── index.ts       # Express + SSE 服务器
│   └── schedule-store.ts  # 日程数据存储
├── src/               # 前端 React 应用
│   ├── components/    # UI 组件
│   │   ├── ScheduleView.tsx  # 日程视图
│   │   └── ...
│   ├── pages/         # 页面组件
│   ├── hooks/         # React Hooks
│   └── ...
├── public/            # 静态资源
└── dist-electron/     # 编译后的 Electron 代码
```

## 技术栈

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, TDesign React
- **Backend**: Express, SQLite, CodeBuddy Agent SDK
- **Desktop**: Electron
- **AI**: CodeBuddy Agent SDK

## License

MIT
