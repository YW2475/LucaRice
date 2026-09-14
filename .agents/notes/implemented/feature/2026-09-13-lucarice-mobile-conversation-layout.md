# Agent Note: LucaRice mobile conversation layout

Status: implemented

English | [中文](2026-09-13-lucarice-mobile-conversation-layout.zh.md)

## Problem

The LucaRice blank-session hero and its field-management and agent-introduction dialogs were arranged primarily for a desktop viewport. On a phone, the fixed-height hero crowded the composer and shortcuts against browser controls, while dialog content became difficult to read or reach.

## Decision

The conversation client plugin uses a narrow-screen layout that keeps the hero vertically scrollable, leaves safe-area clearance beneath the composer, and reduces the headline and shortcut-card footprint. Its quick-action dialogs fit within the mobile viewport, keep their headers available, and scroll their bodies independently. Field details and farm timeline entries reflow for narrow widths, and the Settings field editor keeps touch-sized controls and a single-column form where necessary. The mobile background uses normal scrolling to avoid fixed-background behavior on touch browsers.

## Alternatives considered

- Changing the shared Harness modal or application frame would affect unrelated plugins.
- Keeping the desktop dimensions and shrinking all content would make farming records harder to read and edit.
- Removing information from the mobile field view would make it diverge from the same underlying field record.

## Consequences

The change is isolated to the LucaRice conversation and field-management plugins. Desktop layout and field data access remain unchanged, while phone users can scroll, read, and edit the same records without browser chrome covering essential controls.

## Verification

The affected client bundles and focused component tests build successfully. The deployed page responds normally after the client plugins are restarted.
