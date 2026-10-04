# Agent Note: LucaRice business data in SQLite

Status: implemented

English | [中文](2026-09-12-lucarice-business-data-sqlite.zh.md)

## Problem

LucaRice stored account records, browser login sessions, field profiles, and farm events in separate JSON files. Updating one record rewrote an entire file, and related data could not be queried or updated atomically.

## Decision

LucaRice keeps its business records in `.lucarice-data/lucarice.sqlite3`. The account plugin owns account, login-session, chat-ownership, and archived-chat rows. The field-management plugin owns field-profile and farm-event rows in the same database, and the field-weather plugin reads those field-profile rows. Both connections use SQLite WAL mode and a five-second busy timeout.

The account plugin also owns per-account reply-language rows, so a browser language choice never changes another user's model instructions.

On first use, the account plugin imports `accounts.json` when the database has no accounts. The field plugin imports each user's existing `fields/*/field.json` and `events.json` files once. The JSON files remain untouched as recovery sources and are not used for subsequent writes.

Harness session logs, model credential files, knowledge packages, and image assets retain their existing storage mechanisms. This keeps LucaRice business storage separate from the vendored Harness and leaves model secrets outside the ordinary business database.

## Alternatives considered

- **Continue using JSON files** — it keeps the existing format but rewrites whole documents for ordinary account and field updates.
- **Move Harness session logs and credentials into this database** — those records have different ownership and security requirements, and coupling them to LucaRice would complicate Harness upgrades.
- **Use a separate database for fields** — one database gives account and field plugins a simple, portable deployment unit while table ownership remains separate.

## Consequences

LucaRice business data is portable as one SQLite file and supports atomic updates of related rows. A successful first import marks each account and field user so legacy records are not imported repeatedly. Backups must include the SQLite database and its WAL companion files while the service is running.

## Verification

The local migration checks import legacy account and field records, then verify account ownership, archived chats, field reads, event writes, and field-profile updates through the SQLite-backed implementations.
