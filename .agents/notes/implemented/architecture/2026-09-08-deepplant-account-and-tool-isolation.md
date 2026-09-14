# Agent Note: DeepPlant account and tool isolation

Status: implemented

English | [中文](2026-09-08-deepplant-account-and-tool-isolation.zh.md)

## Problem

DeepPlant's account service was created by the field-management host. A failure while loading that business plugin could therefore remove login together with field access. Field records could also be updated concurrently by the Agent and the settings page, and the RAG host waited for model readiness before allowing the Web application to finish starting.

These couplings are unsuitable for a small public gray test: identity must remain available when an optional business service is down, and two normal writes must not overwrite each other.

## Decision

- Register the account service as an independent Web application plugin.
- Keep account sessions, per-account model credentials, field records, and exports associated with the authenticated account. Knowledge packages and local inference models remain shared read-only resources.
- Reject login and existing sessions for disabled ordinary accounts. Administrators can create users, reset passwords, enable or disable ordinary accounts, and inspect the availability of the five local business services.
- Serialize field-record read-modify-write operations with one process-local lock so Agent updates and settings-page updates use the same persistence path.
- Do not block Web startup while RAG models are loading. RAG, deterministic tools, speech, field management, and weather remain separate processes with independent readiness endpoints.

## Alternatives considered

- Moving all account and field data to a new database now was rejected. One account process and one field-service process are sufficient for the planned single-server 50–100-user gray test. A database migration becomes necessary when DeepPlant runs multiple server instances or needs relational querying across business records.
- Combining all Python tools into one process was rejected because one tool failure would remove unrelated capabilities.
- Keeping the Web process blocked until RAG is ready was rejected because users should still be able to sign in and use unaffected features while a model is loading or unavailable.

## Consequences

The Web application can start and retain login while an individual local tool is unavailable. Administrators can see which local service needs attention, and disabling a user immediately invalidates that user's active sessions. Field writes within the current service process no longer race.

This does not make the application multi-node. Account JSON and field JSON each still have a single owning process, and RAG inference remains serialized by the current model service. Before increasing beyond one application server, move account/session ownership and mutable business records to a shared database and run concurrency tests against the intended hardware.
