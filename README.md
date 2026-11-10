# Codex 用量仪表盘

在本机查看 Codex 的 Token 用量、按公开 API 价格估算的费用、每日趋势、热力图以及会话与子代理明细。支持远程设备快照导入导出、快捷日期范围、近 30 分钟及 1/3/5/10 小时、自定义起止时间。

## 快速启动

需要 **Node.js 22.13 或更新版本**。运行时使用 Node 内置模块和随仓库提供的 Chart.js，无需 Python、API Key 或 `npm install`。

```bash
git clone https://github.com/WebsonLeo/codex-usage-dashboard.git
cd codex-usage-dashboard
npm start
```

启动器会检查健康接口，复用已有服务或启动后台进程，并打开浏览器。默认地址为 <http://127.0.0.1:8766/>。

```bash
# 后台启动，不自动打开浏览器
npm start -- --no-open

# 前台运行，按 Ctrl+C 停止
npm run serve
```

端口冲突时会报错，可通过 `COUSASH_NODE_PORT` 指定其他端口。启动日志位于系统临时目录的 `codex-usage-dashboard-node.log`。

## 安装为 Codex skill

在克隆后的仓库中执行：

```bash
npm run skill:install
```

安装到 `~/.agents/skills/codex-usage-dashboard`，复制技能说明与 Node 运行资源。已有目录会被保留并返回错误；更新前先备份并移走旧安装，再执行安装命令。安装文件是独立副本，之后对源码仓库执行 `git pull` 不会自动更新已安装副本。

需要项目专用技能或自定义位置时，`--dest` 指定完整目标目录：

```bash
npm run skill:install -- --dest /你的项目/.agents/skills/codex-usage-dashboard
```

也可以直接把本仓库克隆到 `~/.agents/skills/codex-usage-dashboard`；仓库根目录已包含 `SKILL.md`。这种安装方式可通过 `git pull --ff-only` 更新，更新前保留自己的本地修改。

在 Codex 中输入：

```text
$codex-usage-dashboard 打开我的用量仪表盘
```

Codex 会发现新技能；如果列表尚未更新，重新启动 Codex。路径及发现方式参见 [OpenAI 官方技能文档](https://developers.openai.com/codex/skills/#where-to-save-skills)。

## 数据与费用

- 默认读取 `~/.codex` 原始会话日志，可通过 `CODEX_HOME` 指向其他日志目录；不会修改原始日志。
- 会话索引和导入快照存于 `~/.codex/cousash-node-usage.sqlite`；费率缓存为同目录的 `cousash-node-price-cache.json`。设置 `CODEX_HOME` 不改变这两个缓存位置。
- 服务仅监听 `127.0.0.1`。启动时向 OpenAI 官方文档同步模型与费率，失败时使用已有缓存；同步请求不上传会话数据。
- 费用是公开 API 价格估算，不代表订阅账单、实际扣费或剩余额度。未知模型不冒充已知费率。
- 导出的快照包含会话信息；分享前自行确认内容。源码仓库不包含个人会话、SQLite 数据、日志或凭据。

## 开发与验证

```bash
npm test
```

默认测试仅依赖 Node，覆盖用量解析、去重、SQLite 索引、时间范围、快照接口、图表数据、启动器和技能安装。测试使用临时数据。

仓库保留原 Python 实现作兼容参考。可选的对照及 Python 回归测试需要 Python 3.11+：

```bash
npm run test:legacy
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Node/Python 对照测试默认调用 `python3`，可用 `PYTHON` 环境变量指定解释器。Python 文件不参与默认 Node 启动和 skill 安装。

## 第三方资源

Chart.js 4.5.1 的 MIT 许可见 [第三方资源说明](THIRD_PARTY_NOTICES.md)。本仓库尚未为自有代码指定开源许可证。
