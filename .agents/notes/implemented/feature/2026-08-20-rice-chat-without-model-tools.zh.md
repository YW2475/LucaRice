# Agent Note: Rice chat excludes coding tools

Status: implemented

English | [中文](2026-08-20-rice-chat-without-model-tools.md)

## Problem

交付版本默认加载编码智能体，其中包含文件、Shell、计划、委派和工作流工具。水稻生产指导需要文字、田间图片、检索、品种、农药和动态信息能力，但不应暴露编码工具。

## Decision

`apps/cli/config/agent-presets/rice-chat/` 是 Web 默认预设。它以 `SYSTEM_PROMPT.md` 作为完整系统提示词，`rice-tools.ts` 仅注册 `search_rice_knowledge`、`search_rice_diagnosis`、`validate_pesticide_safety`、`lookup_rice_variety` 和 `search_web`。前四个工具调用本地 Rice Pi 检索服务，`search_web` 通过 Harness 凭据提供方读取 Tavily 凭据。`rice-time-context.ts` 会在每次模型请求前读取配置的公共时间 API，并将返回的中国时间作为持久化插件消息附加到请求中。

Web 模型路由使用 SiliconFlow `Qwen/Qwen3.6-27B`，并声明支持文字和图片输入。官方 DeepSeek 适配器及其模型设置界面已禁用。Web 预设目录不再加载用户自定义预设，客户端也不加载预设切换、计划、轨迹、工作空间和插件清单控制。

`rice-rag-host` 是 Web 宿主插件。它从可配置的 Python、知识包、模型和品种数据路径启动本地检索服务，并负责子进程生命周期。

`attachment-local` 保留在基础组合中。图片作为用户消息内容直接传递给已选择的多模态模型路由，不需要文件系统或读图工具。

## Alternatives considered

- **仅用提示词限制：** 不采用。工具只要仍在目录中，模型就仍能调用。
- **从基础 Bundle 移除共享执行提供方：** 不采用。Web 组合已经不向模型提供执行工具，修改共享 Bundle 会影响其他 Profile。

## Consequences

新的 Web 会话成为带有五个农业专用工具、但没有编码工具的文字与图片水稻问答智能体。检索服务会随 Web 宿主启动，并使用提供的知识包、本地嵌入模型和重排序模型。已有会话保留创建时记录的预设；重启 Web 服务并新建会话后才会使用该预设。
