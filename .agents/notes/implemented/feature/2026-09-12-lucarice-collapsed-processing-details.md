# Agent Note: Collapsed LucaRice processing details

Status: implemented

English | [中文](2026-09-12-lucarice-collapsed-processing-details.zh.md)

## Problem

LucaRice showed injected context, internal Think summaries, and tool-call names as separate transcript rows before its farming guidance. The technical process interrupted the reading path for farmers.

## Decision

ChatView groups consecutive context, Think-only assistant nodes without answer text, and tool-call nodes into one native disclosure that starts closed. Its count includes only nodes that render, excluding suppressed field-image context and invisible tool-call heads. User messages and final assistant answers stay visible. When an assistant node contains both reasoning and an answer, the answer remains outside the disclosure and renders without the reasoning summary. Opening the disclosure reuses each existing process-row renderer.

## Alternatives considered

- Hiding process records completely would remove a useful optional inspection path.
- Changing Harness session logging would expand the change beyond the client presentation.
- Folding each row independently would leave a repeated technical sequence in the transcript.

## Consequences

The behavior belongs to the conversation client plugin and does not alter durable records or the agent loop. Process rows remain available on demand and retain their existing tool and context presentation.

## Verification

Focused ChatView and reasoning-row tests cover the closed process disclosure, its expansion, and the normal transcript behavior.
