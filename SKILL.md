---
name: codex-usage-dashboard
description: 启动并打开本地 Codex 用量仪表盘。用于查看 Token 用量、费用估算、每日趋势、热力图、会话明细和远程设备快照，支持快捷及自定义时间区间。
---

## 启动

以此 `SKILL.md` 所在目录为工作目录，执行：

```bash
node scripts/open_dashboard_node.mjs
```

启动器会检查并复用已有服务；未运行则后台启动，健康检查通过后自动打开浏览器。回复启动结果及返回的地址，默认是 `http://127.0.0.1:8766/`。仅查询运行状态时读取 `/api/health`，不要因此启动或重启。

需要使用内置浏览器时执行 `node scripts/open_dashboard_node.mjs --no-open`，再用浏览器工具打开返回地址。

## 运行要求与数据

- 使用 Node.js 22.13+（本机已验证 22.22.3）。无需 Python，也无需安装 npm 依赖。若 `node` 不在 PATH，查找已安装的兼容解释器；不要调用旧 Python 启动脚本。
- 服务只监听本机；可通过 `COUSASH_NODE_PORT` 指定端口。若端口属于其他服务，报告冲突，不自动结束该进程。
- 默认只读 `~/.codex` 中的原始日志，支持 `CODEX_HOME`。会话索引与远程快照保存在 `~/.codex/cousash-node-usage.sqlite`，原始日志不被修改。
- 支持原有筛选、日期区间、会话及子代理详情、快照导入导出，以及近 30 分钟、1/3/5/10 小时、自定义起止时间、每日趋势和月历热力图。
- 新启动服务时同步 OpenAI 官方模型与费率，也可点击“同步费率”手动更新。失败时使用最近成功缓存；金额是公开 API 价格估算，不是订阅实际扣费。

## 启动失败

先查看启动器输出的错误与系统临时目录内的 `codex-usage-dashboard-node.log`。启动成功的依据是健康接口返回 `ok: true` 且 `app: codex-usage-dashboard-node`，不能只凭端口存在判断。技能文件和 Node 资源需保持同一目录结构；`scripts/` 与 `assets/` 共同构成可运行版本。
