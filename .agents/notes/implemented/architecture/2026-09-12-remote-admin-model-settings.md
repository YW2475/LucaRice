# Agent Note: Remote administrator access to model settings

Status: implemented

English | [中文](2026-09-12-remote-admin-model-settings.zh.md)

## Problem

LucaRice serves signed-in users through a trusted public authority, while the standard connection plugin keeps every settings and credential method loopback-only. The Models settings page needs those methods to read configured providers and manage the signed-in user's model credential, so an administrator received a 403 before the page could load.

## Decision

`client-connection` has an opt-in `allowRemoteSettingsForAdmin` setting. It requires an `accounts` service. When enabled, only a signed-in administrator from a configured trusted host may call the settings and credential methods used for model configuration. The default remains disabled, and native host actions, agent-preset authoring, and model discovery remain loopback-only.

The LucaRice web composition enables this option because its account host authenticates requests before the API bridge and its credential provider resolves credentials for the active account.

## Alternatives considered

- **Allow settings for every trusted host** — a trusted host is an origin check, not user authentication, so this would expose configuration to callers who are not administrators.
- **Remove the Models settings page** — it avoids the error but removes the place where an administrator manages model access.
- **Modify the Models page to ignore the refusal** — the page would not know its configured provider state and would present unusable controls.

## Consequences

Remote deployments must explicitly opt in and provide the account service; a configuration mistake fails at load. Ordinary users remain unable to call the remote model-configuration methods, while administrators can load and use the Models settings page. The connection host test covers the enabled administrator path and the ordinary-user refusal.
