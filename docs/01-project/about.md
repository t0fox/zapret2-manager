---
id: public-about
title: "Что такое zapret2-manager"
type: guide
status: current
authority: user-guide
updated: 2026-08-22
publish: true
tags: [start, zapret, guide]
---

# Что такое zapret2-manager

Z2M — LuCI-интерфейс и backend для управления zapret2 на OpenWrt. Он связывает
движок, Strategy, списки, DNS и диагностику, но не подменяет владельцев этих
подсистем параллельными реализациями.

## Что входит в Z2M

- единый target-specific пакет `zapret2-manager-full`, содержащий backend, LuCI,
  native helpers и runtime assets для `mediatek/filogic`;
- канонический путь Strategy → Preview → Validate → Apply;
- временный Scanner, который передаёт удачный кандидат в Strategy;
- системные страницы Компоненты, Резервные копии и Настройки.

Engine и Telegram Proxy являются отдельными optional-компонентами. Наличие Z2M
не означает, что `nfqws2` или proxy уже установлены и запущены.

## Основное правило состояния

Не путайте установленный компонент, запущенный процесс, выбранную стратегию и
стратегию, реально применённую runtime. Всегда подтверждайте состояние на
странице-владельце и в Мониторинге.
