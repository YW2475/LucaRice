# Agent Note: Rice chat excludes coding tools

Status: implemented

English | [中文](2026-08-20-rice-chat-without-model-tools.zh.md)

## Problem

The shipped Web default is a coding preset with filesystem, shell, planning, delegation, and workflow tools. A water-rice production advisor needs text, field-image, retrieval, variety, pesticide, and current-information capabilities without exposing coding tools.

## Decision

`apps/cli/config/agent-presets/rice-chat/` is the Web default. Its complete persona reads `SYSTEM_PROMPT.md`, and `rice-tools.ts` registers only `search_rice_knowledge`, `search_rice_diagnosis`, `validate_pesticide_safety`, `lookup_rice_variety`, and `search_web`. The first four tools call the local Rice Pi retrieval service; `search_web` resolves the Tavily credential through the Harness credential provider. `rice-time-context.ts` reads the configured public time API before every model request and appends the returned China time as a durable plugin message.

The Web model route is SiliconFlow `Qwen/Qwen3.6-27B`. The profile declares text and image input. The official DeepSeek adapter and its model settings UI are disabled. The Web roster excludes user-authored presets, and the preset, plan, trajectory, workspace, and plugin-inventory controls are not composed into the client.

`rice-rag-host` is a Web-host plugin. It starts the local retriever from configurable Python, knowledge, model, and variety-data paths, and owns the child-process lifetime.

`attachment-local` remains in the base composition. A photo is user-message content that the selected multimodal route receives directly; it does not need a filesystem or image-reading tool.

## Alternatives considered

- **Prompt-only restrictions:** rejected because a listed tool remains callable despite a prose instruction not to use it.
- **Removing shared execution providers from the base bundle:** rejected because the Web composition already withholds every model-facing execution tool, while changing the shared bundle would alter unrelated profiles.

## Consequences

New Web sessions use a text-and-image rice advisor with five agriculture-specific tools and no coding tools. The retrieval service starts with the Web host from the supplied knowledge package and local embedding and reranker models. Existing sessions retain the preset recorded when they were created; restart the Web host and create a new session to use this preset.
