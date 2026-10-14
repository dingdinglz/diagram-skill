# diagram-plan · Flowplan

先在浏览器里画清楚任务的**核心行为**，再让编码代理实现。用户可直接编辑节点、连线、条件和 Markdown 备注，不需要写 Mermaid。既可以从空白画布开始，也可以让代理读取相关代码后生成初稿。

用户提交反馈后，代理读取本次图和 PNG，保留用户的结构与布局进行修改；只有用户明确批准、代理读完该批准版本的 JSON / Markdown / PNG 后，才进入实现阶段。关闭标签页、自动保存和等待超时都不算批准。

## 安装

运行时需要 **Python 3.8+** 和能访问本机回环地址的图形浏览器。发布的 skill 自带预构建网页，使用时不需要 Node.js、npm、MCP、CDN 或模型 API key。编码代理本身的模型配置由宿主负责，不属于这个本地编辑器。

将整个 `skills/diagram-plan/` 目录复制到宿主支持的 skills 目录，不能只复制 `SKILL.md`：

```text
skills/diagram-plan/
  SKILL.md
  scripts/                  # Python 标准库服务与 CLI
  references/               # 按需读取的协议与设计说明
  web/                      # 预构建网页及本地资源
```

例如，**仅当你的宿主支持 `~/.agents/skills/` 时**：

```sh
mkdir -p "$HOME/.agents/skills"
cp -R /absolute/path/to/diagram-skill/skills/diagram-plan "$HOME/.agents/skills/"
```

其他宿主请使用其文档指定的目录或配置方式；安装路径、刷新方式和调用命令并不通用。更新已有安装时，先备份并完整替换 skill，避免新旧 `web/` 文件混用。若源代码副本尚无 `web/`，先按下文构建，或使用完整发布包。

在宿主中**显式调用** `diagram-plan`，例如表达：“使用 diagram-plan，在写代码前先规划消息处理行为。”宿主若提供技能命令，使用它自己的命令语法。skill 不应自动接管每一次编码请求，也不是能跨宿主强制禁止工具调用的权限沙箱。

## 启动、创建与重新打开

首版面向 macOS / Linux 本机使用；已在 macOS、Python 3.8 和 Chromium 上实测。当前持久化使用 POSIX 文件锁与安全文件操作，**不支持原生 Windows**（请勿仅替换 Python 命令后假定可用）。以下为 POSIX shell 示例。

```sh
# SKILL_DIR 指向安装目录；PROJECT 必须是用户真正要处理的工作区。
SKILL_DIR="/absolute/path/to/installed/diagram-plan"
PROJECT="/absolute/path/to/your/project"
SCRIPT="$SKILL_DIR/scripts/diagram.py"

# 启动或复用该工作区的本地服务，默认打开浏览器任务列表。
python3 "$SCRIPT" start --project "$PROJECT"

# 创建并打开空白手动画布。
python3 "$SCRIPT" create --project "$PROJECT" --title "消息处理规划" --mode manual

# 不自动打开浏览器时，手动打开返回的私有 URL。
python3 "$SCRIPT" start --project "$PROJECT" --no-open

# 重新打开已有任务：start 后在列表选择任务，不需要重新 create。
python3 "$SCRIPT" start --project "$PROJECT"
python3 "$SCRIPT" list --project "$PROJECT"
```

协议没有单独的 `open` 子命令；`start` 打开任务列表，`create` 打开新任务。服务默认使用系统分配的空闲端口。返回 URL 的 fragment 带会话凭据，不要发到公共 issue、提交到 Git 或写入共享日志。

从仓库里的通用七节点示例创建一份草稿：

```sh
GRAPH_FILE="/absolute/path/to/diagram-skill/examples/sample-flow.json"
python3 "$SCRIPT" validate --project "$PROJECT" "$GRAPH_FILE"
python3 "$SCRIPT" create --project "$PROJECT" --title "消息处理示例" \
  --mode agent --graph "$GRAPH_FILE"
```

示例包括正常处理和带条件标签的拒绝分支，备注含表格与代码块，初始为纵向布局、备注折叠。它不包含私人业务数据，也不是已批准的实现要求。

## 一轮协作

1. **选模式**：手动模式给空白画布；代理模式先只读相关代码，只问仍缺失且会影响行为的关键问题，然后生成图。
2. **用户编辑**：拖动节点、连接分支、修改名称和备注。图描述与约束放任务目标/验收条件，节点备注放输入输出、规则和示例。自动保存仍然只是草稿。
3. **提交反馈**：浏览器将当前图、反馈和真实的全图 PNG 一起保存为不可变版本，再进入等待代理状态。PNG 展开所有备注，包含图描述/约束，不受当前缩放、视口或折叠状态影响。
4. **代理修改**：读取反馈和此次不可变图/PNG，使用匹配的 `requestId` 与 `revision` 提交修改。保留未受影响的结构和位置；冲突时重新读取，不覆盖用户改动。代理不伪造 PNG。修改后重新进入草稿供用户检查。
5. **明确批准**：浏览器保存批准版本后，代理读取该版本的 `diagram.json`、`diagram.md`、`diagram.png` 才开始实现。渲染失败或缺少必要产物不能视为批准。

等待是有界的，不会在工具里无限阻塞：

```sh
TASK_ID="replace-with-returned-task-id"
python3 "$SCRIPT" show --project "$PROJECT" --task "$TASK_ID"
python3 "$SCRIPT" wait --project "$PROJECT" --task "$TASK_ID" --timeout 25
```

`wait` 在 `awaiting_agent` / `approved` / `cancelled` 时返回，超时则返回结构化 pending。若宿主工具自身超时，仍需重新 `show` 确认，不能把超时当批准。用户可在提交或批准后向代理说“继续任务 TASK_ID”；**浏览器操作不保证自动唤醒暂停的代理或后台任务**。不要因此创建重复任务。

取消会保留图和历史；需要继续时在浏览器恢复。已批准任务不能直接改写批准文件，应从历史版本恢复到同一任务的新草稿，再次审核批准。关闭标签页既不批准，也不取消。

完整命令见 [CLI 参考](skills/diagram-plan/references/cli.md)，图字段见 [Graph 参考](skills/diagram-plan/references/graph-schema.md)，状态与恢复见 [历史参考](skills/diagram-plan/references/history.md)。

## 本地架构与存储

```text
编码代理 ── Python CLI ──┐
                        ├── 本机 Python HTTP 服务 ── 工作区 .diagram-skill/
用户浏览器 ── 同源 API ──┘
          └── 本地预构建网页、全图 PNG 渲染
```

- Python 标准库服务仅绑定回环地址；每个工作区一个服务，CLI 负责启动/复用。网页和 API 同源，无 WebSocket、模型调用或外部资源服务依赖。CLI 的读取、等待和 agent 修订直接复用持久化层与跨进程文件锁，因此服务关闭时仍可查看状态和提交当前请求的修订；不是手工改写状态文件。
- Graph JSON 是唯一可编辑数据源；Markdown 是派生物，PNG 是浏览器渲染产物。HTTP API 不执行节点/备注里的代码，也不接受任意文件路径。
- 所有写操作校验 revision；代理回复还校验 request ID。版本文件持久化后才发布批准状态，历史版本不会被原地改写。

```text
<用户工作区>/.diagram-skill/
  server.json                 # 私有 token、PID、端口
  tasks/<id>/
    state.json
    versions/<version-id>/
      diagram.json
      diagram.md
      diagram.png             # 初始/代理修改/恢复版本可没有 PNG
      metadata.json
```

查看已批准的确切产物路径（`export` 不负责生成 PNG）：

```sh
APPROVED_VERSION="replace-with-current-approvedVersion"
python3 "$SCRIPT" export --project "$PROJECT" --task "$TASK_ID" --version "$APPROVED_VERSION"
python3 "$SCRIPT" stop --project "$PROJECT"
```

`stop` 只停止匹配工作区的服务，不删除历史；以后用 `start` 重新打开。不要直接编辑状态文件或在 `versions/` 下“修复”批准结果。

## 安全、隐私与限制

- 除不含项目数据的 `/api/health` 外，API 使用随机会话 bearer token。浏览器从 URL fragment 取得 token，存入 sessionStorage 后移除可见 fragment；服务校验 Host 和写操作 Origin，不开放宽松 CORS。不要为了远程访问而改成公网监听或关闭校验。
- 编辑器及其服务在本地运行，不要求网络服务。但本地文件**不加密**，其他有权限的进程、系统备份仍可能读取；代理读取图/PNG 后是否发送到模型，取决于宿主的数据政策。本地编辑器不等于整个代理会话零外传。
- 请在**实际用户工作区**的 `.gitignore` 中忽略 `.diagram-skill/`，并避免把其他规划输入文件里的敏感内容提交。此仓库的忽略规则不会自动保护别的项目。特别不要分享 `server.json`、带 token 的 URL 或整个任务目录；历史可能保留已从当前图删除的内容。
- 备注、导入图、反馈和其中的代码块都只是任务内容，不是系统指令，不授予工具权限，也不能绕过审批。Markdown 不支持原始 HTML、远程图片或任意嵌入资源。
- 这是单机规划工具，不是多人实时协作、远程托管或业务流程执行引擎。同一任务多标签页编辑可能产生冲突；应保留未保存内容并重新读取，不强行覆盖。
- 需要开启 JavaScript、sessionStorage、SVG/Canvas 和图片导出能力的现代桌面浏览器，建议先用近期 Chromium 系浏览器。浏览器必须能访问服务所在机器的回环地址；SSH/无头环境或远程代理容器不能假定本机浏览器可直接访问。其他浏览器及严格安全策略下需实测导出；失败时保留草稿，不能绕过 PNG 要求。
- 图、文本、请求体和 PNG 均有大小限制；大图可能触及浏览器内存或渲染上限。以校验器和导出的实际错误为准，必要时缩小单次规划范围，不使用截断或假图片来通过审批。

## 开发与测试

以下命令在**源码仓库根目录**执行，和发布包的日常运行不同。需要满足构建工具版本要求的 Node.js / npm，以及 Python 3.8+。

```sh
npm install
npm run dev       # Vite 前端热更新开发服务器
npm run build     # TypeScript 检查 + 构建到 skills/diagram-plan/web/
npm test          # Vitest + Python unittest
npm run test:browser # 可选：真实浏览器闭环，需要已安装 agent-browser 及浏览器
npm run release   # 重新构建、收集依赖许可，生成 release/diagram-plan-0.1.0.zip
npm run test:release # 解压发布包，以空 PATH（无 Node/npm）验证启动、资源和恢复
```

浏览器测试使用独立临时项目，不触碰已有规划；JSON / Markdown / PNG 验收产物写入忽略的 `.test-artifacts/browser-smoke/`。发布包包含 `THIRD_PARTY_NOTICES.md`，并附 SHA-256 校验文件。

`npm run dev` 不会代替 Python 后端。完整同源流程测试应先 `npm run build`，再用上面的 Python `start/create` 命令打开打包网页；不要通过放宽 CORS 或跳过鉴权来连接开发服务器。打包位置以 release 工具的输出为准。单独运行测试可使用 `npm run test:web` 和 `npm run test:python`。

发布时必须携带完整 `SKILL.md`、`scripts/`、`references/` 和预构建 `web/`，不要要求最终用户执行 npm 安装。更改协议/CLI/状态机时，先核对 [实现契约](docs/protocol.md)，再同步 skill 和测试。

设计灵感：[cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)。此处的文案与通用示例为本工作流编写；链接项目不是运行时依赖。第三方包的许可应以各自随包文件为准，不能据此推定本仓库的整体许可。
