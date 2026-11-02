# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers reviewing and editing a coding agent's implementation plan locally before authorizing implementation. Repository-supported audience; additional audiences are undecided.

## Product Purpose

Flowplan is a local planning editor. Users inspect a flow, edit nodes and connections, return feedback to an agent, and approve a recorded version.

## Operating Context

A Chinese-language browser workspace backed by the local Python service. React, TypeScript, Vite and React Flow are already established. Graphs may include branches, subflows and loops.

## Capabilities and Constraints

The user confirmed existing product capabilities and backend interfaces remain the foundation, while all presentation, navigation and components may be redesigned. Preserve task lifecycle, revision conflict protection, autosave and recovery, undo/redo, immutable approval, history and export. Preserve local/offline operation: no remotely loaded fonts, CDN or model credentials. Shared graph geometry must stay consistent with rendering and export.

## Brand Commitments

Product name: Flowplan. The user delegates visual direction and asks for a complete, refined, mature redesign with fluid interactions comparable to leading product interfaces. No legacy visual styling is binding.

## Evidence on Hand

README.md, README.zh-CN.md, docs/usage.md and docs/protocol.md document the product. examples/ contains actual sample graphs. docs/images/ contains historical screenshots, not authoritative current designs. No invented commercial claims or customer data.

## Product Principles

- Keep the plan and its review state understandable.
- Preserve edits and clearly distinguish draft, historical and approved states.
- Make canvas editing efficient without hiding essential review actions.
- Keep local workflows independent of external services.
