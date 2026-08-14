---
id: operations-installation
title: "Установка"
type: operations
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [operations, installation, openwrt]
---

# Установка

zapret2-manager пока является development/prototype проектом. Репозиторий **не предоставляет подтверждённый публичный URL готового бинарного пакета**, поэтому документированный путь установки начинается со сборки исходного кода в подготовленном OpenWrt build tree или SDK.

## Пакеты

Backend package называется `zapret2-manager`. Веб-интерфейс поставляется как `luci-app-zapret2-manager` и зависит от backend. Также существует target-specific meta-package `zapret2-manager-full`, который устанавливает backend и LuCI вместе и в текущем репозитории имеет ограничение на target `mediatek_filogic`.

Backend Makefile определяет реальные зависимости текущей сборки: необходимые ucode modules, utilities и JSON-related packages. Используйте Makefile как источник истины и не копируйте старый список зависимостей из внешних заметок.

## Сборка

В подготовленном OpenWrt build tree или SDK README репозитория указывает следующие targets:

```sh
make package/zapret2-manager/compile V=s
make package/luci-app-zapret2-manager/compile V=s
make package/zapret2-manager-full/compile V=s
```

Используйте только targets, подходящие выбранной платформе OpenWrt. Для обычной разработки backend и LuCI можно собирать отдельно; full meta-package остаётся target-specific.

Host-side тест исходного кода не заменяет сборку package целевым toolchain. Backend включает native components, которые компилируются OpenWrt target compiler, поэтому успешная SDK build является важным доказательством перед установкой на устройство.

## Установка собранных packages

После завершения сборки установите packages, созданные вашей системой OpenWrt, стандартным способом для используемой версии и package manager. Эта документация не фиксирует универсальный путь к generated artifact, потому что он зависит от конкретного build environment.

Backend должен быть установлен до LuCI package или одновременно с ним. После установки откройте LuCI и найдите **Zapret 2 Manager** в разделе Services / Сервисы.

Backend package при необходимости инициализирует управляемое хранилище Strategy, выполняет reload rpcd в post-install и включает свой service. LuCI package очищает стандартные cache entries через package lifecycle hooks.

## Первая проверка

До постоянных изменений убедитесь, что страница zapret2-manager открывается в LuCI и приложение может прочитать свой текущий status. Это отделяет проблемы установки и backend connectivity от проблем конкретной Strategy.

После этого перейдите к [Первому запуску](./first-run.md): начните с просмотра текущего состояния, затем используйте Preview и Validate там, где установленная сборка предоставляет эти этапы.

Если страница отсутствует, загружается не полностью или backend status недоступен, сначала откройте [Устранение неполадок](./troubleshooting.md).

## Обновление

Репозиторий пока не описывает универсальную публичную команду «обновить до последней версии» или общий rollback для всех development builds. Рассматривайте обновление как установку packages из известной ревизии и обязательно повторяйте базовую проверку приложения после package operation.

При сравнении сборок сохраняйте commit/revision и версии установленных packages. Формулировка «поставил latest» значительно хуже помогает диагностике, чем точная ревизия.

## Удаление

Для удаления используйте штатное поведение package manager вашей версии OpenWrt. Не заменяйте package removal широким ручным удалением файлов и другого состояния платформы: это может затронуть данные, которыми zapret2-manager не владеет.

## Что читать дальше

- [Первый запуск](./first-run.md)
- [Устранение неполадок](./troubleshooting.md)
- [Статус и план развития](../01-project/status-roadmap.md)
- [Разработка](../08-development/index.md)
