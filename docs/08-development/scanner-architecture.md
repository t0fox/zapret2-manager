---
id: scanner-architecture
title: "Архитектура Scanner"
type: architecture
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [development, scanner, e2e]
code: [zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc#scanner_edit_action]
---

# Архитектура Scanner

RPC создаёт bounded request, `scanner-cli-entry` передаёт его в canonical
worker, planner materializes only candidates, а probe adapter выполняет
реальную проверку.

Lifecycle evidence должен покрывать baseline, dependency preflight, temporary
activation, stabilization, probe, cleanup и terminal reconciliation. При
uncertain cleanup Scanner fail-closed.
