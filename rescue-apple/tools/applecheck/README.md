# applecheck — проверка Apple-кода без Xcode

В контейнерах агентов нет Xcode и Metal-компилятора, а `download.swift.org` недоступен.
Эти скрипты ловят ошибки компиляции `Sources/MaydayRender`, `Sources/MaydayApp`, `Sources/AppIOS|AppMac`
и `Tests/MaydayRenderTests` до сборки на Mac. Xcode-сборку они **не заменяют**.

| Скрипт | Что делает | Чего не ловит |
|---|---|---|
| `check-msl.sh` | Каждый `.metal` компилируется хостовым `clang++ -std=c++14 -fsyntax-only` через шим `msl/include/metal_stdlib`: адресные пространства убраны, векторы — ext_vector с размерами MSL, конструкторы и встроенные функции объявлены перегрузками. Смешанные вызовы скаляр/вектор (`clamp(float3, 0, 1)`) запрещены, потому что MSL их не гарантирует. `ShaderTypes.h` проверяется в C11: `static_assert` размеров должны пройти. | Правила, которые есть только в Metal: индексы атрибутов, допустимость адресных пространств, function constants, implicit LOD вне fragment-функций. |
| `fetch-swift.sh` + `env.sh` | Swift 6.0.3 для Linux из пакетов Ubuntu (`swiftlang`, `libxml2-16`, archive.ubuntu.com). Пакеты распаковываются в `~/.cache/mayday-swift`, не устанавливаются. | — |
| `check-swift.sh` | 1. Собирает MaydayCore через SwiftPM (пакет `rescue-apple/Core`).<br>2. Собирает заглушки фреймворков (`stubs/src`: Metal, MetalKit, QuartzCore, simd, CoreGraphics, Combine, GameController, UIKit/AppKit, SwiftUI). В заглушках только используемая поверхность API, с именами и сигнатурами Apple SDK.<br>3. Типизирует модуль приложения дважды (проходы iOS и macOS) в режиме Swift 5 и прогоняет тесты рендера.<br>4. Запускает `harness/main.swift`: bootstrap-симуляция на настоящих данных (все пресеты × качества) упаковывает uniform-структуры, проверяет кадрирование камеры (вертолёт на NDC y = +0,1) и порядок DrawList. | Актор-изоляцию (`@MainActor` в SDK). Неточности самих заглушек: заглушка верна ровно настолько, насколько верно её описание API. |

```sh
rescue-apple/tools/applecheck/check-msl.sh
rescue-apple/tools/applecheck/fetch-swift.sh            # один раз (~500 МБ)
. rescue-apple/tools/applecheck/env.sh
rescue-apple/tools/applecheck/check-swift.sh            # ≈ 1 мин; артефакты в $MAYDAY_CHECK_OUT (по умолчанию /tmp/mayday-applecheck)
```

Когда код начинает пользоваться новым API Apple, добавьте его в `stubs/src/<Framework>.swift`. Сигнатуры берутся из документации SDK, а не подгоняются под вызов. Uniform-значения bootstrap-симуляции сверены с живой веб-игрой (пресеты calm, storm, nightCalm, `__game.ocean.uniforms`): совпадают до 3-го знака, кроме статистик волн, которые зависят от сида миссии.
