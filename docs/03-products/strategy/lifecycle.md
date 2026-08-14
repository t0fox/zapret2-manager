---
id: product-strategy-lifecycle
title: "Lifecycle Strategy: от каталога до проверенного Apply"
type: product
status: current
authority: evidence
updated: 2026-08-14
publish: true
tags: [strategy, lifecycle, preview, validate, apply, rollback]
---

# Lifecycle Strategy: от каталога до проверенного Apply

`Strategy` — это продуктовая модель постоянной конфигурации zapret2-manager. Её задача не просто хранить строку аргументов nfqws2, а связать **идентичность стратегии, упорядоченные Profiles, каталог, компиляцию, проверки, применение и последующую верификацию** в один управляемый lifecycle.

В текущем `main` присутствуют отдельные модули `strategy-model.uc`, `strategy-catalog.uc`, `strategy-compiler.uc`, `strategy-state.uc`, `strategy-status.uc` и `strategy-cli.uc`. Они работают поверх уже существующего Profile/apply substrate, поэтому Strategy не создаёт второй независимый writer постоянной конфигурации.

## Общая последовательность

```text
Catalog / User Strategy
        ↓
Strategy model
        ↓
ordered Profiles
        ↓
compiler
        ↓
preflight
        ↓
Preview
        ↓
Validate
        ↓
Apply
        ↓
snapshot + CAS transaction
        ↓
upstream runtime restart / reload
        ↓
verification
        ↓
active Strategy status
        ↓
commit результата
     или rollback
```

Каждая стрелка здесь означает отдельный контракт. То, что объект успешно прошёл раннюю стадию, не означает автоматический успех следующей.

## Strategy как агрегат, а не набор несвязанных Profile

В модели совместимости с Avatar `Strategy` владеет упорядоченным массивом `profiles[]`. Profile остаётся исполнимой единицей с аргументами и состоянием `enabled`, но не становится отдельным продуктом верхнего уровня.

Порядок имеет значение: compiler должен сохранять порядок включённых Profiles. Отключённые Profiles остаются в Strategy и видимы пользователю, но не участвуют в effective runtime candidate. Это позволяет временно выключить часть стратегии, не уничтожая её структуру.

Встроенные и пользовательские Strategy также имеют разную ownership-модель. Встроенный каталог рассматривается как immutable product data, тогда как пользовательские копии/Strategy можно изменять через отдельный state path. Пользовательский объект не должен случайно модифицировать исходный builtin.

## Catalog и identity

`strategy-catalog.uc` отвечает не только за список красивых названий. Catalog identity нужна дальше по lifecycle: Preview и Apply должны понимать, **какую именно Strategy и из какой ревизии каталога** видел пользователь.

Это защищает от сценария, где UI показывает один объект, каталог обновляется или state меняется, а Apply позже использует уже другое содержимое под тем же визуальным названием.

Публичная документация поэтому различает display metadata и authoritative identity. Имя удобно для человека; ID/revision/digest нужны control plane.

## Compiler

Compiler преобразует агрегат Strategy в effective конфигурацию. Здесь решаются порядок Profiles, включённость, аргументы, ссылки на assets и другие преобразования, которые относятся к продуктовой модели, а не к UI.

LuCI не должен самостоятельно собирать финальную command line. Если browser и backend имеют два разных compiler, со временем они неизбежно начинают понимать одну Strategy по-разному. Поэтому compiled output принадлежит backend.

Результат compiler ещё не означает, что все runtime-зависимости существуют. Именно для этого нужна следующая стадия.

## Preflight

`native-preflight.uc` и связанные проверки оценивают кандидата до постоянной записи. В зависимости от Strategy здесь могут проверяться доступность engine/runtime, корректность аргументов и необходимые Lua/blob/list dependencies.

Сильная сторона native подхода — fail before mutation: если кандидат нельзя безопасно исполнить, лучше остановиться до изменения постоянной конфигурации.

В Avatar parity это может классифицироваться как `INTENTIONAL_DEVIATION`, если внутренний механизм строже исходного продукта, но сохраняет ожидаемое пользовательское поведение. Parity здесь не означает обязательное ослабление safety boundary.

## Preview

`Preview` — **неизменяющая** стадия. Она нужна для ответа на вопрос: «что именно будет построено из этой Strategy?».

Полезный Preview может включать идентичность Strategy, effective args/command, количество активных Profiles, digest кандидата и сведения о зависимостях. Его важное свойство — отсутствие permanent mutation.

Поэтому Preview должен оставаться полезным даже в некоторых ситуациях, когда Apply недопустим. Например, Strategy без включённых Profiles можно осмысленно показать как пустой effective candidate, но Validate/Apply должны отдельно решить, допустимо ли это для исполнения.

## Validate

`Validate` переводит вопрос с «что получится?» на «можно ли это применять сейчас?». Здесь проверяется не только синтаксис модели, но и admission conditions для mutation.

Успешный Validate всё ещё не означает, что конфигурация записана. Это отдельный gate перед Apply.

Такое разделение полезно и для UI, и для автоматизации: пользователь может получить понятную ошибку до изменения runtime, а тесты могут отдельно доказывать pure model/compiler и mutation admission.

## Apply как permanent authority boundary

`Apply` — самая важная граница lifecycle. До неё система работает с намерением и кандидатом. После успешного Apply manager начинает считать новую Strategy частью постоянного authoritative состояния.

Apply не должен принимать произвольный устаревший browser object и писать его напрямую. Mutation связывается с persisted identity/revision и проходит через существующий transactional writer.

Типичный путь:

1. перечитать authoritative state;
2. проверить revision/digest;
3. выполнить preflight;
4. создать snapshot;
5. записать candidate через sanctioned writer;
6. перезапустить/перечитать runtime через его владельца;
7. проверить фактическое состояние;
8. зафиксировать active Strategy identity только при согласованном результате.

## Verification

После restart проверяется не только факт завершения команды. Нужны runtime observations: ожидаемый процесс/состояние сервиса, соответствие применённой конфигурации и признаки, по которым Strategy можно считать активной или, наоборот, drifted.

`strategy-status.uc` нужен именно для read-only projection активной identity и наблюдений. Runtime health не следует сохранять как вечное свойство Strategy-файла: здоровье процесса меняется независимо от metadata стратегии.

## Rollback

Если mutation произошла, но verification не подтверждает новый runtime, система должна использовать сохранённый snapshot и восстановить прежнее состояние. Затем необходимо проверить и сам rollback.

```text
Apply candidate
    ↓
verification OK ─────→ commit
    │
    └─ verification FAIL
              ↓
           rollback
              ↓
      rollback verification
```

Rollback поэтому является частью success/failure contract, а не аварийной командой администратора после того, как транзакция уже потеряла контроль над состоянием.

## Drift и reconciliation

Active Strategy identity и реальное runtime-состояние могут разойтись: файлы изменились вне manager, runtime был перезапущен, dependency исчезла или наблюдение стало неопределённым.

В этом случае status должен показывать drift/uncertainty, а не переписывать Strategy-файл текущим наблюдением. Канонический конфигурационный объект и runtime observation — разные слои.

## Что уже сильно, а что ещё ограничивает Avatar parity

Strategy — одна из наиболее зрелых областей текущего проекта. В pinned Avatar audit целый ряд Strategy-capabilities уже имеет `PARITY`: aggregate model, ordered/enabled Profiles, builtin/user Strategies, metadata, duplicate flow, Preview, Validate/Apply и catalog slices.

Оставшиеся зависимости лежат не только внутри Strategy. Полная parity требует более богатых registries для Lua/blob/IP-set и связанных assets, некоторых catalog/applicability semantics и дальнейшей интеграции с Scanner/routing flows.

Это важный принцип roadmap: сильная Strategy vertical не означает автоматически завершённый Scanner или unified routing. Она предоставляет им authoritative handoff и permanent Apply boundary.

## Связь со Scanner

Scanner может использовать Strategy catalog/compiler для построения кандидатов, но его execution должен оставаться transient. Найденный результат не становится permanent автоматически.

Правильная передача выглядит так:

```text
Scanner result
   ↓
Strategy reference / user Strategy
   ↓
Preview
   ↓
Validate
   ↓
Apply
```

Таким образом Scanner исследует, а Strategy владеет постоянным решением.

Подробнее: [Стратегии](./index.md), [Lifecycle Scanner](../scanner/lifecycle.md), [Runtime flow](../../02-architecture/runtime-flow.md), [Avatar parity](../../01-project/avatar-parity.md).
