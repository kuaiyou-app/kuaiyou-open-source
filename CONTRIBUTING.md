# 快游大师贡献指南 (Contributing to Kuaiyou Master)

首先，感谢您花时间为快游大师贡献代码或技能库！快游大师是一个致力于普及端侧 AI 自动化编程生态的开源项目。无论您是修复 Bug、改进 MCP Server，还是用大模型生成了实用的技能 JSON，我们都热烈欢迎！

在参与社区贡献前，请确保您已阅读并同意我们的 [社区行为准则 (Code of Conduct)](./CODE_OF_CONDUCT.md)。我们致力于为所有人提供一个友好、包容的技术社区。
## 1. 我们需要什么贡献？

我们特别鼓励以下两种形式的贡献：

- **核心工具贡献**：改进 `autoace-cli`（源码目录 `autoace-cli/`）的协议稳定性。
- **开源技能库贡献**：您使用 AI 或手动编写的自动化 JSON（即「技能」），如果具有较好的普适性（如自动清理缓存、每日自动签到、关闭更新弹窗），欢迎提交到 `skills/`，造福更多人。引擎回归用例、`test_*` 命名和无限刷视频请放到 `autoace-cli/fixtures/device/`，不要进社区目录。

---

## 2. 如何提交一个优秀的技能

我们极力推荐您通过 **Cursor / Claude 结合 MCP Server** 来生成技能，这比手写 JSON 效率高得多。

### 提交要求

如果您想将一个技能合并到我们的官方案例库中，请确保您的 Pull Request 包含以下内容：

1. **经过实时契约校验的 JSON 文件**：开启 App MCP 服务，先调用 `get_kuaiyou_schema` 获取当前契约，再使用 `validate_kuaiyou_skill` 校验。不要提交或引用本地 Schema 副本。
2. **适用版本声明**：说明校验和真机测试所使用的 App 版本。
3. **效果演示**：请附带一段简短的 GIF 动图或视频链接，展示技能在真机上的运行过程。

仓库的 `scripts/validate-skills.mjs` 只执行离线 JSON、引用和业务规则检查；它不能代替当前 App 的契约校验。

### 🌟 AI 辅助提交一键指令
不知道怎么写 PR 描述？您可以直接复制下面这段提示词给您的 AI 助手：

> "请帮我将当前测试成功的技能 JSON 整理成一个标准的 Markdown 提交提案。
> 提案需包含：1. 技能名称与简介；2. 该技能解决了什么痛点；3. JSON 核心逻辑代码块；4. 提醒用户该技能适用的 App 版本。
> 请按照 GitHub PR Template 的风格输出。"

将 AI 生成的文本粘贴到您的 Pull Request 描述中即可！我们已经在 GitHub 中配置了专属的 **Skill Submission** Issue 模板和 Pull Request 模板，直接填写即可。

---

## 3. 开发环境与提交流程 (Development Workflow)

本项目遵循经过优化的 **Git Flow** 与 **Issue 驱动** 的分支管理规范。为了保持历史的整洁与可追溯，**严禁使用 sprint (迭代) 分支**将多个任务打包提交。所有开发必须按粒度拆解并对应具体的 Issue。

### 分支命名规范
- `main`：生产环境主分支，随时可发布。
- `develop`：主开发分支，包含下一次发布的所有最新开发代码。
- `feature/<issue-id>-<short-desc>`：新功能分支（从 `develop` 检出，例如 `feature/42-schema-validation`）。
- `bugfix/<issue-id>-<short-desc>`：常规缺陷修复（从 `develop` 检出）。
- `hotfix/<issue-id>-<short-desc>`：紧急线上修复（从 `main` 检出，合并回 `main` 和 `develop`）。
- `docs/...` / `chore/...`：文档更新或构建工具链调整等非功能性分支。

如果您想修改本仓库的代码（`autoace-cli`、文档或技能 JSON；Android 客户端为闭源），请遵循以下步骤：

1. **先提出 Issue**：任何代码层面的修改，请确保已经有一个相关的 Issue 进行跟踪。
2. **Fork 本仓库** 到您的个人账号下。
3. **Clone 到本地并配置 Git**：
   ```bash
   git clone https://github.com/YOUR-USERNAME/kuaiyou-open-source.git
   cd kuaiyou-open-source
   # 强制拉取代码时使用 rebase，避免产生无意义的交叉 merge 节点
   git config pull.rebase true
   git checkout develop
   ```
4. **创建特性分支**（记得带上 Issue ID）：
   ```bash
   git checkout -b feature/123-your-amazing-feature develop
   ```
5. **本地运行与测试**：
   如果您修改了 `autoace-cli`，请确保在本地测试通过：
   ```bash
   cd autoace-cli
   npm install
   npm run typecheck
   npm test
   ```
6. **提交代码 (Commit)**：
   我们遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。请使用规范的提交信息格式（例如 `feat: add new target selector` 或 `fix: mcp pairing timeout message`）。
   **要求：**如果提交解决了 Issue，请在 Commit 描述中附带 `Fixes #123` 或 `Closes #123`。
7. **推送到远程并提交 PR**：
   ```bash
   git push origin feature/123-your-amazing-feature
   ```
   然后在 GitHub 页面点击 "Compare & pull request"。
   > **⚠️ 注意**：提交 Pull Request 时，请务必将目标分支 (base branch) 设置为 `develop` 而不是 `main`。推荐在合并到 `develop` 时使用 **Squash and Merge** 策略。请务必仔细填写弹出的 **Pull Request 模板** 中的 CheckList。

### 代码风格规范
- **Node.js (MCP Server)**：基于 TypeScript，请在提交 PR 之前运行 `npm run build` 确保没有 TS 编译错误。为了保证代码质量，我们的 GitHub Actions 会对提交的 PR 进行自动构建测试。
## 4. 取得联系与反馈

如果您在贡献过程中遇到任何问题，欢迎在 GitHub 的 Issues 中发起提问。维护者通常会在 24 小时内回复您。

期待您的奇思妙想，让我们一起打造最强悍的终端 AI 自动化生态！🚀
