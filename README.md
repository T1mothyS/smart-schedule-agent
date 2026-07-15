# 智能日程表 Agent

个人周期事务与行动管理中心。保留 AI 日程对话，并统一管理今日行动、日历、周期事务、可靠提醒和完成证明。

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

### ✅ 今日行动与周期事务
- 登录后默认进入今日行动中心，聚合下一步、今天、临期、逾期和今日完成
- 内置订阅、保险、证件、会员、房租、水电、车辆年检和自定义模板
- 不提供跳过；逾期周期保留手动完成；不存在的月度日期自动落到月末

### 🔔 可靠提醒与完成证明
- 邮件、站内和浏览器通知，持久化队列、幂等去重、免打扰和失败重试
- 完成记录支持备注、金额、账单日期和鉴权附件
- 用户加密导出/恢复、全站快照和阿里云 OSS 离机备份

### ✨ 智能导入
- 自然语言和最多 3 张截图只生成待确认草稿
- 可选 163 官方邮箱 IMAP 转发导入，按令牌和 Message-ID 去重

### 💻 跨平台支持
- **Web 端**：浏览器访问
- **桌面端**：Windows/macOS/Linux
- 数据实时同步

## 快速开始

### 环境要求
- Node.js 20+
- npm
- CodeBuddy API Key

### 安装依赖

```bash
npm ci
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

**完整验证**

```bash
npm run typecheck
npm test
npm run build
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
│   ├── index.ts              # Express + SSE 服务器
│   ├── action-center.ts      # 今日行动聚合
│   ├── activity-store.ts     # 完成、附件、通知和 AI 草稿
│   ├── reminder-store.ts     # 通用周期规则
│   └── backup-service.ts     # 加密备份与 OSS
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
