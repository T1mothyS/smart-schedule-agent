# Bundle 观察基线

- Status: LIVING（方法）；下列 JSON 为 AUDIT-SNAPSHOT。
- Scope: 已完成的 Vite 生产构建，全部 JS/CSS 体积及初始静态依赖闭包。
- Last verified commit/version: 应用源码 `8854a38` / `0.21.0-260915.0924`，2026-09-15。
- Authority: 当次构建文件与 `.vite/manifest.json`；不使用历史文件名推断当前构建。
- Update trigger: 路由加载、重依赖、CSS、构建工具或依赖锁文件变化。
- Supersedes: 首次可提交测量方法；未设置强制预算。
- Do not use for: LCP、交互耗时、服务器实际压缩、生产部署或浏览器验收。

## 使用

在已审查的本地配置或无真实配置/数据的源码副本中运行。Vite 构建本身可能读取当前目录 `.env`；下面的测量脚本不会加载配置。

```powershell
npm run build:client -- --manifest
if ($LASTEXITCODE -ne 0) { throw '生产构建失败，停止测量' }
node scripts/measure-bundle.mjs dist
if ($LASTEXITCODE -ne 0) { throw 'Bundle 测量失败' }
```

需要保存时，将 JSON 输出到明确的审计产物位置。例如在 PowerShell 7 中：

```powershell
$bundleJson = node scripts/measure-bundle.mjs dist
if ($LASTEXITCODE -ne 0) { throw 'Bundle 测量失败，不保存基线' }
$bundleJson | Set-Content -LiteralPath (Join-Path $env:TEMP 'ai-calendar-bundle.json') -Encoding utf8
```

测量脚本仅使用 Node 标准库；只读 dist，不构建、不加载 `.env`、不访问网络，不写数据库或源文件。缺 manifest、入口、引用 chunk/资源，或路径越界时失败。禁止把旧 dist 的成功测量当作新源码构建通过。额外 `--manifest` 只输出构建元数据，不改变路由分包或 warning limit；现有 build/CI 脚本不变。

## 指标解释

- `entries`：manifest 的入口。当前应用只有一个 HTML 入口；多页项目按所有入口的静态闭包并集统计，不重复计算 shared chunk。
- `totals.initialJs` / `initialCss`：仅沿 `imports` 遍历，包含对应 CSS，不沿 `dynamicImports` 把异步模块误计入首屏。
- `nonInitialJs`：未进入初始闭包的 JS，不保证每次打开异步页面都请求全部文件。旧产物也会被枚举，因此先完成正常清理输出的生产构建。
- `files`：构建目录所有资源的 raw/gzip bytes、SHA-256、类型和加载分类；排除 `.vite/` 元数据和 source map。包含全部 JS/CSS。
- `top10`：按 raw bytes 排序的最大 10 个资源（排除 HTML、metadata、source map）。
- gzip 使用 Node zlib 默认压缩级别，按文件压缩后求和；不等于 HTTP header/字体图片加载/缓存/实际服务器参数，也不等于 Vite 显示值的逐字一致。
- manifest 不表达手工写入 HTML 的外部 script/link 或运行时预加载策略；添加此类资源时须另核对 HTML 与浏览器请求。当前入口没有这些额外引用。

## 首次快照

[完整 JSON](baselines/bundle-2026-09-15.json) 包含全部资源、闭包和 hash。

| 指标 | Raw bytes | Gzip bytes |
|---|---:|---:|
| 初始 JS（1 个） | 1,525,880 | 456,761 |
| 初始 CSS（1 个） | 371,766 | 56,269 |

JS 共 97 个，其中 96 个不属于首屏静态闭包。此快照使用 Node 24.14.1 / npm 11.11.0、Vite 8.2.2 和现有 node_modules，在隔离源码副本构建；不声明经过全新 npm ci、CI Node 22.12.0 或生产浏览器验证。应用源码与审计基线一致，新增观察脚本不改变 bundle。

## 回归使用

暂不设硬失败预算。下一轮优化按 route lazy → feature lazy → optional heavy dependency → CSS → 重新测量的顺序，用同样参数比较 initialJs/initialCss、全部文件和最大资源。大 Mermaid 异步 chunk 不能冒充首屏退化；实际浏览器网络和渲染表现另行验证。

脚本正确性测试：`node --test scripts/measure-bundle.test.mjs`。覆盖静态循环/共享依赖、异步 CSS、多入口去重、缺失引用及路径越界。

## Phase 2 对照（2026-09-15）

版本 0.21.1-260915.1408；[完整快照](baselines/bundle-phase2-2026-09-15.json)、[模块闭包](baselines/modules-phase2-2026-09-15.json)、[验收报告](PHASE2-FRONTEND-LOADING.md)。保留首次快照，未修改预算或 warning 阈值。

| 指标 | Phase 1 raw / gzip | Phase 2 raw / gzip | gzip 变化 |
|---|---:|---:|---:|
| 首屏 JS | 1,525,880 / 456,761 | 354,241 / 113,164 | -75.22% |
| 首屏 CSS | 371,766 / 56,269 | 199,563 / 29,830 | -46.99% |
| 全部 JS | 6,657,933 / 1,936,227 | 6,668,473 / 1,954,499 | +0.94% |

体积从首屏转移到按需加载；全部产物略增来自分包与边界代码，不能将首屏减少量写成下载所有页面后的总节省。当前首屏静态闭包为 6 JS + 1 CSS；实际运行时访问其他页面才请求相应资源。
