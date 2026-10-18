# MAYDAY — нативный порт на Metal (iOS + macOS): план

Статус: план готов к исполнению. Дата: 2026‑10‑16. Ведущий документ порта.
Источник истины: веб‑версия `rescue/` (three.js r185, 158 модулей, ~53 тыс. строк), `rescue/src/CONTRACT.md`, `rescue/DESIGN.md`.
Этот документ ничего не меняет в `rescue/`. Изменения веб‑кода, без которых невозможен паритет, вынесены в задачи W1–W8 (§5.6).

---

## 0. Коротко: ключевые решения

| № | Решение | Почему |
|---|---|---|
| D1 | Один рендерер на чистом Metal (MTKView + свой frame graph). Без RealityKit, SceneKit и SpriteKit. | Игра держится на кастомных шейдерах (океан, пост, HUD). Чужие движки их не выразят. |
| D2 | `MaydayCore` — чистый Swift без Apple‑фреймворков, кроме Foundation. Собирается и тестируется `swift test` на Linux. Используются типы `SIMD2/3/4` из stdlib; модуль `simd` не используется, потому что на Linux его нет. | Паритетные тесты гоняются в CI без Mac. Ядро не знает о GPU. |
| D3 | Симуляция в `Double` с тем же порядком операций, что в JS: three‑математика переписана 1:1 (`Vector3`, `Quaternion`, `Matrix4`, `Euler`). В GPU данные уходят как `Float`. | JS `number` — это double. Только так возможна побитовая сверка. |
| D4 | Трансцендентные функции — своя библиотека `CJSMath`: порт fdlibm плюс алгоритмы V8 для `hypot` и `pow`, собранные с `FP_CONTRACT OFF`. Системный libm не используется. | Проверено измерениями (§5.2): в Node 22 `sin/cos/tan/exp/log/atan/atan2/asin/acos/sinh/tanh/expm1/log1p` побитово равны fdlibm. glibc расходится в 1–20 % случаев, Apple libm тоже будет расходиться. |
| D5 | Эталон CPU‑векторов — Node 22: модули симуляции запускаются headless. Headless Chromium 141 нужен только для DOM, canvas, WebGL, Intl, шрифтов и раскладки. | В Chromium `sin/cos/pow` берутся из glibc (LGPL, платформозависимо), повторить их нельзя. fdlibm лицензионно чист. |
| D6 | Процедурная геометрия, собранная вручную из примитивов three (~1000 деталей: вертолёт, маяк, судно, буровая, плоты, люди…), **запекается** из веба в `.mmesh`. В Swift портируются только генераторы, нужные в рантайме: сетка океана, рельеф, валуны, круги, конусы, цилиндрические сетки, квады. | Побитово воспроизвести генераторы three (порядок вершин, швы, нормали) — объём XL и источник дрейфа. |
| D7 | Освещение — `ThreePBR.h`: точный порт подмножества r185 MeshStandard/Physical. Это GGX‑Smith‑correlated, DFG, multiscatter, clearcoat (только корпус вертолёта), punctual‑затухание, конус прожектора, полусфера, IBL и PCF. Фиксированный набор источников из CONTRACT (1 dir + 1 hemi + 2 spot + 6 point). | Закон «цвет палитры = цвет на экране» требует тех же формул. С фиксированным набором источников не плодятся варианты PSO. |
| D8 | Тени: одна направленная карта, как в вебе (бокс 250 м, привязка к текселям, PCF 5 Vogel + IGN). Каскадов нет. | Паритет. CSM возможен в M9, если на больших экранах не хватит разрешения. |
| D9 | IBL: env‑куб считается в рантайме compute‑ядрами (аналитическое небо из `weather/env.js` → куб 128² → GGX‑префильтр). Запечённых env‑карт нет. | Небо зависит от погоды и времени суток. Политика перепекания (≤ 1 раз в 4 с, не во время вспышки) переносится как есть. |
| D10 | Кадр: HDR `rgba16Float` + MSAA (memoryless) → bloom → (composite+ACES+sRGB одним проходом) → FinalPass → drawable `bgra8Unorm` (не `_srgb`), `colorspace = sRGB` → HUD. Всегда через HDR, в том числе на low. | Так устроен веб. На TBDR склейка composite+output экономит один полноэкранный проход. |
| D11 | MSAA фиксирован на уровень качества: low 1, medium 2, high 4. Динамическое разрешение меняет только масштаб (viewport‑subrect плюс `uvScale`) и считается по GPU‑времени. Переключения 4→2 на лету нет. | Число сэмплов входит в PSO. Таймеры rAF на 60/120 Гц врут (см. post.js). Отклонение от веба задокументировано. |
| D12 | Полётный HUD (canvas‑оверлей, радар, карта, панели, предупреждения, лебёдка) рисуется в Metal через `HudKit`: SDF‑линии, дуги, заливки, glyph‑атлас CoreText, ореол shadowBlur. Геометрию и состояние строит Core как переносимый `HudDrawList`. Бумажные экраны (меню, брифинг, пауза, дебрифинг, настройки) сделаны на SwiftUI. | 60 Гц, синхронно с кадром, маски под текстом, glitch/EMP. SwiftUI для этого не подходит. |
| D13 | Звук: WebAudio‑семантический DSP‑движок на C (`CMaydayDSP`: ноды, таймлайны AudioParam, модуляция на audio‑rate), который хостит AVAudioEngine через один `AVAudioSourceNode`. Звуковые модули портируются 1:1 в переносимый Swift (`MaydaySynth`). В бандл ничего не запекается: шум, IR и волновые таблицы генерируются при старте и сверяются по SHA‑256. | Штатные AU в AVAudioEngine не повторяют семантику WebAudio. Ядро на C тестируется офлайн на Linux. |
| D14 | Платформы: iOS/iPadOS 17+, macOS 14+ (только Apple silicon, нативный AppKit+SwiftUI, не Catalyst). Цель — 60 fps: iPhone 13 на medium, M1 на high. | Брифинг: «iPhone 13+/M1». Metal 3, async PSO, `@Observable`. |
| D15 | Только русский язык в v1. Тексты и русская грамматика (плюрализация, род, числительные) живут в Core и данных. Английский вынесен в отдельную веху; локализация через String Catalog не подходит, нужен модуль грамматики. | Источник истины русскоязычный. Грамматику генерирует код, а не таблицы. |
| D16 | Ключи и форматы сохранений как в вебе: `mayday.settings.v1` и `mayday.progress.v1` (JSON) в UserDefaults, привязки клавиш в строках `KeyboardEvent.code`. | Импорт и экспорт прогресса, общие векторы тестов, совпадение подписей клавиш. |

---

## 1. Цели и принципы

### 1.1 Цели (измеримые)

1. **Паритет с веб‑версией.**
   - CPU‑симуляция: побитовое совпадение на коротких горизонтах; на длинных — допуски из §5.1.
   - Картинка: визуальные «золотые» кадры с допусками.
   - Звук: огибающие и таймлайны совпадают точно, спектр и громкость — в допусках.
   - Все тексты совпадают побайтно.
2. **Единый стиль.** Документальная «съёмка с дрона»:
   - те же палитры и законы цвета (палитра → ACES → sRGB);
   - тот же HUD двух регистров: полётный и бумажный;
   - те же шрифты (Oswald / JetBrains Mono / Inter).
3. **Производительность** (кадр 16,7 мс):
   - iPhone 13 (A15), medium: GPU ≤ 13 мс, CPU главного потока ≤ 8 мс, 1 %‑low ≥ 55 fps;
   - 10 мин игры без `thermalState > .fair`;
   - M1, high: GPU ≤ 12 мс при 2560×1600.
4. **Один код для iOS и macOS.** Платформенный код только в `MaydayApp/Platform` и адаптерах ввода (≈ 5 % строк).
5. **Веб — источник истины.**
   - Ни одной ручной константы в Swift: все числа, таблицы и строки приходят из `Resources/Data/*.json`, экспортированных из веб‑кода.
   - Изменения правил: сначала в вебе, потом реэкспорт.

### 1.2 Не‑цели v1

- Новый контент и механики. Android, visionOS, Intel‑Mac, сеть, Game Center (опционально в M9).
- Английская локализация (см. M9 и §8).
- Переход на RealityKit, SceneKit или SpriteKit. Использование ray tracing и mesh shaders.

### 1.3 Принципы

- **Порт, а не переписывание.** Каждый Swift‑тип прослеживается до JS‑модуля (таблица §2.9). Имена полей и uniform сохраняются (`uWaveA`, `altTarget`…), чтобы работал `grep` по обеим кодовым базам.
- **Детерминизм — свойство архитектуры.**
  - Все RNG сидируются и инжектируются; `Math.random` в геймплее запрещён (W1).
  - Время приходит только из `GameTime`. Порядок систем фиксирован.
  - Хеши и RNG считаются в `UInt32` с wrap (`&+`, `&*`).
- **Core не знает о рендере.** Render читает снапшоты Core. Пулы, видимые геймплею (слоты вихрей, лимиты обломков, вспышки, glow‑кольца), принадлежат Core.
- **Отклонения от веба — только через реестр** (§10). В реестре записаны причина, проверка и владелец.

### 1.4 Платформы и уровни качества по умолчанию

| Устройство | GPU family | Качество по умолчанию | Примечание |
|---|---|---|---|
| iPhone 13/14, iPad mini 6 (A15/A16) | apple8 | medium | MSAA×2, сетка океана 224, 6 волн |
| iPhone 15 Pro+ (A17 Pro+), iPad M1+ | apple9 / apple7(M) | high | MSAA×4, 300, 8 волн |
| Mac M1+ | apple7+ | high | |
| A12–A14 (не целевые) | apple5–7 | low | best‑effort, без гарантий |

- Внутреннее разрешение считается по веб‑правилу: `min(scale, pixelRatioCap, sqrt(1920·1080 / (w·h)))`. На iPhone 13 (2532×1170) это ≈ 0,84, то есть ≈ 2119×979. FinalPass и HUD рисуются в полном разрешении drawable.
- 60 fps по умолчанию: `preferredFramesPerSecond = 60`. 120 Гц включается в настройках («Плавность 120 Гц»), Info.plist `CADisableMinimumFrameDurationOnPhone = YES`. Поведение, зависящее от частоты кадров (адвекция памяти воды, шахматный опрос плавучих объектов), соответствует веб‑нормали 60 Гц.

---

## 2. Архитектура

### 2.1 Модули и зависимости

```
                      ┌────────────────────────────── App (iOS / macOS targets) ─────────────────────────────┐
                      │ MaydayApp: GameHost(MTKView), ввод (GameController/NSEvent/UITouch), Haptics,        │
                      │ Photos/NSSavePanel, UserDefaults, жизненный цикл, launch args                        │
                      └──────┬───────────────────────┬───────────────────────┬──────────────────────────────┘
                             │                       │                       │
                 ┌───────────▼──────────┐ ┌──────────▼─────────┐ ┌──────────▼───────────┐
                 │ MaydayUI (SwiftUI)   │ │ MaydayRender (Metal)│ │ MaydayAudio          │
                 │ экраны, ChartPainter │ │ рендерер, шейдеры,  │ │ AVAudioEngine/Session│
                 │ (CoreGraphics), Theme│ │ HudKit, пост        │ │ хост                 │
                 └───────────┬──────────┘ └──────────┬─────────┘ └──────────┬───────────┘
                             │                       │                      │
   SwiftPM (Linux+Apple)     │                       │           ┌──────────▼───────────┐
   ┌─────────────────────────▼───────────────────────▼──┐        │ MaydaySynth (Swift)  │
   │ MaydayCore (pure Swift + Foundation)               │◄───────┤ звуковые модули,     │
   │ Math/JSMath, Core(Game, EventBus, Settings), Data, │        │ граф, офлайн‑рендер  │
   │ Input, Look, Ocean, Weather, World, Hazards, FX,   │        └──────────┬───────────┘
   │ Heli, Camera, Survivors, Mission, Radio, Post,     │        ┌──────────▼───────────┐
   │ HUD(models/draw lists), Text(RU), Mesh(MeshKit)    │        │ CMaydayDSP (C, RT)   │
   └─────────────────────────┬──────────────────────────┘        └──────────────────────┘
                   ┌─────────▼────────┐
                   │ CJSMath (C)      │
                   └──────────────────┘
```

- Цели SwiftPM (`Core/Package.swift`, собираются на Linux): `CJSMath`, `MaydayCore`, `CMaydayDSP`, `MaydaySynth`, `mayday-vectors` (CLI для сверки), тесты.
- Цели XcodeGen (`project.yml`, только Apple): `MaydayRender`, `MaydayAudio`, `MaydayUI`, `MaydayApp` (общий код приложения), `Mayday-iOS`, `Mayday-macOS`, `MaydayRenderTests`, `MaydayUITests`.
- Зависимости однонаправленные: Core ← Render/UI/Synth/App. Core никогда не импортирует Apple‑модули.

### 2.2 MaydayCore — правила

- **Импорты:** только `Foundation` (JSONDecoder, Data, URL). Нет `simd`, `Metal`, `AVFoundation`, `UIKit`/`AppKit`, `GameController`, `CryptoKit`.
- **Числа:**
  - `Double` везде, где в JS `number`.
  - `Float` только там, где в JS `Float32Array`: кабель лебёдки, сетки рельефа, капли на линзе, трек полёта, atlas `ref/grad`. Округление `Float(x)` выполняется в тех же местах, где JS пишет в массив.
  - Целочисленная арифметика хешей: `UInt32`/`Int32` с явными `&+ &* &-`; `>>>` переводится в `UInt32` сдвиг, `|0` — в `Int32(truncatingIfNeeded:)`.
  - `Math.imul` → `JS.imul`.
- **JS‑семантика вынесена в `Math/JSNumber.swift`:**
  - `jsRound` (половина вверх, с сохранением −0);
  - `jsMod` (= `truncatingRemainder`) и `toUint32`/`toInt32` (ToUint32 от double, в том числе для произведений > 2³²);
  - `jsToString` (ECMAScript Number::toString) и `jsToFixed` (точное десятичное разложение, при равенстве — большее n).
- **Без FMA.**
  - Swift не сливает `a*b+c`. Запрещены `fma`, `addingProduct` и `.sum()` у SIMD: у SIMD‑суммы не определён порядок, поэтому `dot` пишется явно `x*x' + y*y' + z*z'`.
  - Векторы — структуры `V2`/`V3`/`Quat`/`Mat4` (Double) с методами в порядке операций three.js.
- **Горячие пути без аллокаций:** `heightAt`, `windAt`, `forceAt` вызываются сотни раз за кадр. Используются `struct`, `inout`, предвыделенные пулы и `ContiguousArray`.
- **Идентичность.** JS опирается на ссылки (`WeakMap`, `Set` объектов, ссылки в событиях). В Swift это стабильные ID (`GroupID`, `CarrierID`, `PersonID`, `HazardID`, `FlareID`) и словари по ID с явным `reset()` на `mission:setup`.
- **Изоляция ошибок.** В вебе система, бросившая исключение, отключается. В Swift trap роняет приложение. Поэтому:
  - системы пишутся не‑бросающими: проверка индексов, нет `!`, деление на `dt` только с защитой от нуля;
  - в debug‑сборке `GameContext` ловит NaN/Inf в ключевых состояниях (`assertFinite`) и логирует через `os_log` в App‑слое (Core использует инжектируемый `Logger`‑протокол).

### 2.3 Игровой цикл и контекст

- **`GameContext`** (класс, ссылочная семантика) — аналог `ctx`. Содержит:
  - `events: EventBus`, `input: InputState`, `rng: Mulberry32(1337)`, `noise: Simplex2D(1337)`, `look: Look`, `settings: Settings`;
  - `time: GameTime {t, dt, realT, realDt, frame}` и `mode: GameMode`, переключаемый через `setMode()`, который эмитит `game:mode {from,to}`;
  - `timeScale`, `params` (launch args), `warmup: WarmupState {due, compiling, render, idle}`;
  - системы по протоколам: `WeatherAPI`, `OceanAPI`, …, `PostAPI`.
- **`GameSystem`** (протокол): `init(ctx)` (не трогает другие системы), `start()` (= `init()` из веба), `update(dt:)`, `resize(w:h:)`.
- **`Game.tick(frameDelta:)`:**
  - `realDt = min(frameDelta, 0.1)`; `dt = mode == .paused ? 0 : realDt * timeScale`;
  - `input.poll()`;
  - системы в порядке `weather → ocean → world → hazards → heli → survivors → fx → cameraRig → radio → mission → audio → hud → post`;
  - `RUN_WHEN_PAUSED = {cameraRig, audio, hud, post, radio}` получают `realDt`.
  - Вертолёт внутри — фиксированный шаг 1/60, не больше 8 подшагов, интерполяция `alpha`.
  - Для тестов есть `Game.step(dt:)` с инжектированной последовательностью `dt`.
- **Поток.** v1: симуляция и кодирование команд Metal идут на главном потоке в `draw(in:)` (как в вебе). Если по профилю нужно, в M9 симуляция переносится в отдельный поток с двойной буферизацией снапшотов.
- **Стабы.** `stubs.js` превращается в протоколы с реализациями по умолчанию (`StubSystems.swift`) для изоляции систем в тестах (аналог `?only=`/`?stub`).

### 2.4 Событийная шина

- Синхронная, строковые имена — канон из `events.json`. Семантика:
  - порядок регистрации;
  - итерация по снимку;
  - повторная регистрация того же обработчика — no‑op;
  - `once()` отписывается до вызова;
  - re‑entrancy (обработчик эмитит события).
- **Payload типизирован:** `enum GameEvent` с ассоциированными структурами (~60 событий). На каждое имя в `events.json` есть case; тест проверяет полноту.
- **`EventTrace`** (debug): журнал `(frame, t, name, payload JSON)` в том же формате, что веб‑рекордер (W5). Нужен для replay‑паритета.
- **Порядок подписки систем повторяет веб.** Mission подписывается в конструкторе, radio и audio — в `start()`. Это влияет на тексты радио и звуки.

### 2.5 MaydayRender

**Каркас**

- `RenderDevice`: `MTLDevice`, очереди, библиотека `default.metallib`.
- `FrameRing`: 3 кадра в полёте, `DispatchSemaphore(3)`. На каждый слот — один shared‑`MTLBuffer` 8 МБ с bump‑аллокатором (выравнивание 256 Б) для uniform и instance‑данных кадра.
- `PipelineCache`: ключ PSO = (семейство, function constants, vertex layout, color/depth format, sampleCount, проход).
- `RenderTargets`: аллокация по максимальному размеру уровня; dynres через viewport‑subrect.
- `FrameGraph`: фиксированный список проходов (не универсальный граф).

**Представление сцены**

- `DrawItem {mesh, material family + params, transform | instance buffer, bounds, renderOrder, layers, castShadow, receiveShadow, transparent, blend, depthTest, depthWrite, cull, heat, thermMass, id}`.
- Сортировка — копия `WebGLRenderList` three r185:
  - opaque: (renderOrder, programID, z ↑, id);
  - transparent: (renderOrder, z ↓, id), где z — clip‑z позиции объекта.
- Отсечение по bounding sphere, `frustumCulled = false` там же, где в вебе. Для инстансов — `InstanceCulling` (из `survivors/geo.js`); теневые батчи не отсекаются по инстансам.
- **Слои** (`layers: UInt32`) из three:
  - бит 0 — main;
  - 1 — только тень (лопасти‑стробоскоп);
  - 2 — heat (тепловые прокси: невидимы в main и тени);
  - 3 — thermal mass.
- Плюс `heat` и `thermMass` на каждом элементе. Закладываются с первого дня (иначе тепловизор придётся ретрофитить во все кластеры).

**Проходы кадра (порядок)**

1. *Compute/предпроходы:*
   - перепекание env‑куба (по политике `EnvRebakePolicy`);
   - память воды (render pass в ping‑pong `rgba16Float` 512/384: advect плюс instanced stamps с additive);
   - ресемплинг WaterRings (вершины в кольцевом буфере).
2. *Тени:* `depth32Float` 512/1024/2048; орто‑камера света с тем же lookAt‑базисом (up = +Y), снап к текселям; draw‑list по `castShadow` и слою 1; отдельные index‑ranges `shadowRange` (LOD рельефа, shadow‑only заглушки); alpha‑test и деформирующие depth‑пайплайны (растительность, чайки).
3. *Тепловой проход* (только когда тепловизор видим, плюс один prewarm):
   - `rg8Unorm` + depth в масштабе 0,3/0,4/0,5;
   - элементы со слоями 2 и 3, без culling, без вершинных деформаций владельца (как веб);
   - море не рисуется.
4. *Сцена:* MSAA‑цвет `rgba16Float` (memoryless) плюс `depth32Float` (memoryless) → `storeAction = .multisampleResolve` в `sceneHDR` (`rgba16Float`). Внутри:
   - opaque;
   - океан (`renderOrder 10`, после пропсов ради early‑z);
   - прозрачные корзины по `renderOrder` (1…28: multiply‑тени, кольца, коллары, лампы, лучи, воронки, частицы, дождь, glow);
   - режимы смешивания additive, alpha, multiply (`dst·src.rgb`, premultiplied).
5. *Bloom:* high‑pass (soft knee 0,3, Rec.709) → 5 мипов × H/V‑размытие (ядра 6/10/14/18/22, σ = k/3) от ½ (¼) разрешения; на low выключен.
6. *Composite + Output (склеено):* `post = sRGB_OETF(ACES_Hill(exposure · (sceneHDR + 3·strength·Σ f_i·blur_i)))` → `rgba16Float`. Склейка эквивалентна вебу до округления fp16 промежуточной суммы.
7. *FinalPass* → drawable `bgra8Unorm`:
   - капли на линзе, конденсат, соль, CA, DOF фото, вихрь;
   - FLIR‑композит, вспышка, edge‑пульсы;
   - грейдинг, виньетка, зерно, леттербокс, дизеринг.
8. *Захват фото* (по запросу): копия FinalPass в offscreen‑`bgra8Unorm` → blit в shared‑буфер → CGImage (sRGB) → PNG. HUD не попадает в кадр.
9. *HUD* (`HudKit`) поверх drawable, смешивание в гамма‑пространстве (как canvas браузера); затем present.

**Освещение (`Shaders/Common/ThreePBR.h`)** — порт r185:

- `BRDF_Lambert = albedo/π`;
- `BRDF_GGX` (D_GGX, V_SmithCorrelated, F_Schlick), `DFGApprox`, `computeMultiscattering`;
- clearcoat‑слой;
- `getDistanceAttenuation` (`1/max(dᵈᵉᶜᵃʸ, 0.01) · saturate(1 − (d/cutoff)⁴)²`);
- `getSpotAttenuation` (`smoothstep(coneCos, penumbraCos, cosθ)`);
- полусфера `mix(ground, sky, 0.5·n.y + 0.5)`;
- `geometryRoughness` по производным нормали.

Единицы физические, без legacy‑режима. Набор источников фиксирован (CONTRACT):

- `dir[1]` (солнце/луна, с тенью), `hemi[1]`;
- `spot[2]`: прожектор вертолёта, луч маяка;
- `point[6]`: брюхо вертолёта, палуба судна, 4 пула fx.

Выключенный источник = интенсивность 0. Варианты PSO по числу источников не плодятся.

**Нормали в инстансах** — как в three: `objectNormal /= vec3(dot(im[0],im[0]), dot(im[1],im[1]), dot(im[2],im[2])); objectNormal = im * objectNormal`.

**Туман:** общий `applyFog()` из патча `core/look.js`.
- `vFogOff` — мировое смещение от камеры; фокус `fwd.xz · camY / max(−fwd.y, 0.25)`.
- Горизонтальная дистанция; `smoothstep(near, far)`; множитель `(1 − 0.6·smoothstep(30, 140, worldY))`.
- `mix` к `fogColor` в линейном HDR.
- Вызывается в конце каждого семейства с `FC_FOG = true`. Ветка EXP2 мертва.

**IBL** (`EnvironmentProbe`):
- compute `EnvSky` (VERT/FRAG из `weather/env.js` как функция направления) → куб 128² `rgba16Float` с мипами;
- compute `Prefilter` (GGX importance sampling) по уровням шероховатости;
- выборка через порт `textureCubeUV`‑отображения roughness→mip из r185, чтобы блики пропсов совпали;
- irradiance — выборка самого шероховатого уровня по нормали (как `getIBLIrradiance`);
- `environmentIntensity·(1 + 3·flash)`.

**Конвенции координат**

- Мир как в вебе: Y вверх, север = −Z, восток = +X, курс по часовой от севера, метры и секунды.
- Матрицы в Core — column‑major three (`Matrix4.elements`). Core строит GL‑проекцию (`makePerspective`, z ∈ [−1, 1]) для CPU: `worldToScreen`, `screenToWater`, HUD, frustum. Render умножает её на `glToMetal` (`z' = 0.5z + 0.5w`). Reverse‑Z не используется (near 2, far 1200, `depth32Float`).
- Грани: CCW = front (`setFrontFacing(.counterClockwise)`); `BackSide` → cull front.
- Текстуры‑данные (atlas, coast, drops, все DataTexture) и картинки: строка 0 = v 0. Canvas‑PNG при загрузке переворачиваются по строкам, чтобы повторить `flipY` three. Шейдеры используют GL‑UV как есть.
- Render targets: в Metal NDC y = +1 → строка 0. Полноэкранные проходы считают `vUv` в GL‑стиле и сэмплируют RT через `rtUV(uv) = (u, 1−v)`. `fragCoordGL = (x, uRes.y − y)`.
- Проходы, пишущие «данные» (память воды), переворачивают clip‑y в вершинном шейдере, чтобы строки совпали с GL: иначе пена отзеркалится по z, а адвекция пойдёт назад.
- `glDFdy(x) = -dfdy(x)` — всегда при переносе `dFdy`.

**Цвет**
- drawable `bgra8Unorm`, `CAMetalLayer.colorspace = sRGB` (иначе P3‑дисплеи пересатурируют).
- Все hex‑константы конвертирует экспортёр (THREE.Color sRGB → linear); в JSON лежат оба значения. Свой `Color.srgbToLinear` в Core проверяется векторами.

**Динамическое разрешение** (`DynResController` в Core, вход — GPU‑время из `MTLCommandBuffer.gpuStartTime/gpuEndTime`):
- окно 1 с; > 18 мс → −0,05, < 13 мс → +0,05; минимумы 0,67/0,75/0,8;
- подсказка о качестве после 10 с.

Отклонение D11: число сэмплов не меняется.

**Прекомпиляция PSO** вместо `warmup.js`:
- манифест ключей PSO строится из реестра семейств (и сверяется с дампом программ веба, §4.1);
- при старте, `mission:setup` и смене качества — `makeRenderPipelineState` async в `TaskGroup`, сначала по приоритету океан, пропсы, вертолёт, люди;
- состояния `ctx.warmup` сохраняются (`due → compiling → render → idle`, на них опираются тесты и `thermal.prewarm`);
- Metal кэширует PSO между запусками. `MTLBinaryArchive` — в M9, если холодный старт больше 3 с.
- Сборка шейдеров: Xcode `MTL_FAST_MATH = NO`, `MTL_LANGUAGE_REVISION = Metal31`. Быстрые функции разрешены точечно через `fast::` после проверки «золотыми» кадрами.

**Фоторежим:** состояние в Core (`PhotoModeState`), DOF и грейды — в FinalPass, захват — п. 8, сохранение — `MaydayApp/Platform/PhotoSaver` (iOS: PHPhotoLibrary add‑only; macOS: `~/Pictures/MAYDAY` или NSSavePanel). Свободная камера — `Camera/FreeCam` плюс новые жесты на тач (§8).

### 2.6 MaydayAudio, MaydaySynth, CMaydayDSP

- **`CMaydayDSP` (C11, real‑time, переносимый).** Квант рендера 128 кадров, 48 кГц, стерео. Ноды:
  - Gain;
  - BiquadFilter (формулы WebAudio, Q в дБ для LP/HP, peaking);
  - Oscillator (sine/square/saw/triangle и PeriodicWave через band‑limited wavetable‑мипы, как Chromium, с normalize и disableNormalization, detune);
  - BufferSource (loop, playbackRate, offset, stop, onended);
  - WaveShaper (интерполяция кривой, без oversampling);
  - StereoPanner (equal‑power по спеке, включая стерео‑вход);
  - Delay (в том числе в циклах обратной связи);
  - DynamicsCompressor (порт ядра Chromium с авто‑makeup);
  - Convolver (неравномерное разбиение по Гарднеру и фоновый воркер, как ReverbConvolver Chromium; normalize = true; FFT — pffft или KissFFT, одна реализация на всех платформах);
  - метр peak/RMS.

  Также:
  - `AudioParam`‑таймлайн с семантикой Chromium (`setValueAtTime`, `linear`/`exponential`, `setTarget`, `cancel`), audio‑rate вход в параметры (сумма с базовым значением);
  - правила up/down‑mix каналов (моно‑осцилляторы плюс стерео‑шум);
  - события в прошлом зажимаются к «сейчас»;
  - lock‑free SPSC‑кольцо команд main → render и событий render → main (`onended`);
  - предвыделенные пулы (до 512 нод, 24 голоса, очереди событий фиксированной ёмкости);
  - на render‑потоке никаких аллокаций и ARC.

  Лицензия: порты из Blink и Chromium под BSD‑3 с нотисом.
- **`MaydaySynth` (Swift, переносимый).**
  - API графа в стиле WebAudio (`createGain()`…) поверх команд DSP;
  - модули 1:1: `Mixer`/`VoicePool`/`emitterLaw` (graph.js), `DSPResources` (dsp.js), `RotorSound`, `EnvironmentSound`, `RadioVoice`, `Alarms`, `MusicDirector`, `WinchSound`, `SfxLibrary`, `ExtrasSound`;
  - `AudioDirector` (audio.js) — проводка событие → звук, тики 30/20 Гц, таймеры игрового времени;
  - `renderOffline(seconds:)` для тестов на Linux.
- **`MaydayAudio` (Apple).**
  - `AVAudioEngine` с одним `AVAudioSourceNode` (стерео 48 кГц), render‑блок вызывает `mdsp_render`;
  - `AVAudioSession` (`.ambient`, уважает беззвучный режим; настройка «Звук в беззвучном режиме» → `.playback`);
  - прерывания, смена маршрута, `AVAudioEngineConfigurationChange` (пересборка на macOS), пауза по `scenePhase`;
  - «разблокировка жестом» не нужна (отклонение: экран «нажмите любую клавишу» убирается).
- **Что синтезировать, а что запекать.**
  - v1: синтезируется всё, как в вебе. Шум white, pink и brown (4 и 6 с), IR 2,8 с, капли Минарта, град, треск, пузыри генерируются на фоне при старте (~1,6 млн сэмплов, < 50 мс в `-O`) и сверяются по SHA‑256 с экспортом. PeriodicWave‑таблицы считаются при старте.
  - Запечённого звука в бандле нет.
  - Запасной план, если CPU на A15 > 12 % ядра: путь low‑quality из веба (reverb — delay‑петля, у музыки слои 1–3), затем бейк IR‑хвоста.
- **Бюджет:** ~110 постоянных нод, свёртка ≤ 3 % CPU A15, общий звук ≤ 12 % одного ядра.

### 2.7 MaydayUI (и HUD)

- **Модели HUD в Core (`MaydayCore/HUD`):** `HudSnapshot` (model.js), `FlightHudLayout`, `OverlayBuilder` → `HudDrawList`, `EdgePlacement`, `RadarModel`, `TacMapModel`, `PanelsViewModel`, `WarningsModel`, `ToastQueue`, `Subtitles`, `WinchPanelModel`, `HintBubble`, `HudPalette`, `Ticker`, `Typewriter`, `MenuModel`, `ScreenStack`/`ModeRouter`, `ChartModel`, `RuFormat`.
- **`HudDrawList`:** примитивы `polyline` (dash, dashOffset, caps), `arc`, `ellipse`, `polygon` (выпуклые и невыпуклые), `rect`, `radialGradient`, `text(run, fontID, px, align, baseline, tracking)`, `clip(rect|circle|polygon)`, `alpha`.
  - Три слоя: `world` (маскируется размытыми прямоугольниками текста — замена `destination‑out`), `screen`, `radar`.
  - Параметры композита: ореол (`shadowBlur (4 − haze)·dpr`, rgba(0,0,0,.6)), EMP‑пропуск кадров, хроматический сдвиг glitch, общая альфа ночью (.82).
- **`HudKit`** (в `MaydayRender/Hud`, Metal):
  - instanced SDF‑квады для сегментов, дуг и кругов (AA, round caps, dash по длине дуги);
  - триангуляция полигонов (ear clipping) с заливкой solid или radial;
  - glyph‑атлас (CoreText‑растеризация coverage при фактическом scale; кэш по `(font, weight, px)`; ключ строки → `CTLine`);
  - отдельный проход ореола (разделимый Гаусс альфы слоя);
  - маска текстов; композит glitch.
  - Измерение текста для раскладки Core — через протокол `TextMeasurer`: в App это CoreText, в Linux‑тестах — таблица ширин, экспортированная из Chromium (`hud/text_widths.json`).
- **SwiftUI‑экраны (`MaydayUI/Screens`):** Boot (предупреждение о вспышках), Title, Operations, Briefing, Pause, Settings, Controls, Debrief, Confirm, Note, PhotoOverlay.
  - Фокус и навигация с клавиатуры и геймпада — свой `MenuModel` (повтор 180/90 мс, обёртка в сетке), а не SwiftUI focus engine.
  - Бумажные карты: `ChartModel` (Core) → `ChartPainter` (CoreGraphics, один раз на операцию или resize) → `Image`. Карандашные круги и трек анимируются в SwiftUI `Canvas`.
  - Зерно бумаги (feTurbulence) — запечённый PNG.
  - Фильтр фона экрана операций (sepia/brightness/contrast/saturate) — одна запечённая цветовая матрица.
- **Шрифты:** в бандле лежат немодифицированные OFL‑файлы (без сабсеттинга, чтобы не трогать Reserved Font Name):
  - Oswald (variable, 400–700);
  - JetBrains Mono 400 и 600 (500 → 400, 700 → 600, как CSS‑матчинг);
  - Inter 400–600; курсив синтезируется наклоном CTFont, как браузер.

  Регистрация через `UIAppFonts` / `ATSApplicationFontsPath` до первого кадра.
- **Переходы:** статика «радиопомеха» (250 мс, своп на 45 %) — `Shaders/UI/Static.metal` поверх всего; выключается при reduceMotion.

### 2.8 App (MaydayApp, Mayday-iOS, Mayday-macOS)

- **Корень:** SwiftUI `WindowGroup` → `ZStack(MetalView, BootOverlay, FatalOverlay, ScreensLayer)`. MetalView — `UIViewRepresentable`/`NSViewRepresentable` вокруг `MTKView` (делегат `GameHost`). HUD рисуется внутри Metal, экраны — SwiftUI поверх. iPhone — только landscape (гейт портретного режима не нужен), `UIRequiresFullScreen = YES`; iPad — landscape, Stage Manager позже.
- **Ввод** (`MaydayApp/Input`) сводится к `RawInputFrame` для Core:
  - клавиатура — `GCKeyboard` (iOS/iPadOS с аппаратной клавиатурой, macOS) с таблицей `GCKeyCode ↔ KeyboardEvent.code` (`KeyCodeMap.swift`, позиционная, ЙЦУКЕН работает);
  - на macOS ещё `NSEvent`‑монитор для Esc/Tab и режима фокуса;
  - мышь: macOS — `NSEvent` (позиция в точках, кнопки, колесо) и `GCMouse`; iPad — pointer/hover;
  - геймпад: `GCController.extendedGamepad` → W3C‑индексы (`pad_map` из `input.json`), пороги нажатий триггеров как в вебе;
  - тач: `TouchControlsView` (UIKit, multi‑touch) по `touch.js`: плавающий стик R 64, слайдер высоты с фиксаторами 90/40/15 м, кнопки ЛЕБЁДКА/ПРОЖ/ФАЛЬШ/РУПОР/ПЛОТ/пауза → `setVirtualAxis`/`setVirtualButton`.
  - Сочетания Cmd‑Q/W/F на Mac — системные. Модификаторы никогда не биндятся.
- **Хаптика:** `HapticRules` (Core) → `GCController.haptics` (два continuous‑события, CHHapticEngine с перезапуском при reconnect и foreground). На iPhone — `UIImpactFeedbackGenerator` на тач‑кнопках и подмножество правил; это продуктовое отклонение, выключаемое в настройках.
- **Хранение:** `UserDefaultsSettingsStore` (те же JSON‑блобы `mayday.settings.v1` и `mayday.progress.v1`), запись прогресса в фоне с debounce. Импорт и экспорт прогресса JSON через share‑sheet (копия формата localStorage).
- **Окружение:**
  - `UIAccessibility.isReduceMotionEnabled` / `NSWorkspace.accessibilityDisplayShouldReduceMotion` → reduceMotion и reduceFlashes по умолчанию; `MADimFlashingLightsEnabled()` → reduceFlashes;
  - idiom → `isTouch`;
  - `ProcessInfo.thermalState` → `ThermalGovernor` (§8).
- **Launch args вместо URL‑параметров:** `-mayday.seed 101 -mayday.mission first -mayday.debug YES -mayday.dynres NO -mayday.quality low -mayday.autostart YES -mayday.weather storm -mayday.tod 0.8` (NSArgumentDomain в UserDefaults). Плюс debug‑меню (FPS, статистика пост‑обработки, тумблеры систем `only/stub`).
- **Info.plist и entitlements:**
  - `NSPhotoLibraryAddUsageDescription` (рус.);
  - `GCSupportsControllerUserInteraction`, `GCSupportedGameControllers = ExtendedGamepad`;
  - `ITSAppUsesNonExemptEncryption = NO`;
  - `PrivacyInfo.xcprivacy` (UserDefaults CA92.1, без трекинга и сбора);
  - macOS: sandbox и `com.apple.security.files.user-selected.read-write`, `LSApplicationCategoryType = public.app-category.simulation-games`.

### 2.9 Соответствие веб → Swift (все модули)

Пути Swift даны относительно `rescue-apple/Sources/` (для `C/` — относительно `rescue-apple/Core/Sources/`). «baked» — запекается из веба (§6). `C/` — `MaydayCore/`, `R/` — `MaydayRender/`, `S/` — `MaydaySynth/`, `U/` — `MaydayUI/`, `A/` — `MaydayApp/`.

**Каркас, core/\*, пост‑обработка, оболочка**

| Веб | Core (тип → файл) | Render / UI / Audio / App |
|---|---|---|
| `main.js` | `Game`, `GameTime`, `GameMode`, `WarmupState` → `C/Core/Game.swift`, `C/Core/GameTime.swift` | `GameHost` (MTKViewDelegate, resize, pixelRatio) → `A/GameHost.swift`; `Renderer` → `R/Renderer.swift` |
| `core/events.js` | `EventBus`, `GameEvent`, `EventTrace` → `C/Core/EventBus.swift`, `C/Core/Events.swift`, `C/Core/EventTrace.swift` | — |
| `core/haptics.js` | `HapticRules` → `C/Input/HapticRules.swift` | `HapticsDriver` → `A/Input/HapticsDriver.swift` |
| `core/input.js` | `InputState`, `Bindings`, `StickCurve`, `RawInputFrame` → `C/Input/InputState.swift`, `C/Input/Bindings.swift` | `KeyboardMouseAdapter`, `GamepadAdapter`, `KeyCodeMap` → `A/Input/*.swift` |
| `core/look.js` | `Look` (setWind/setFronts, `gustField`/`frontsAt`/`cloudAt`), `LookTextures` (загрузка `.rgba`, `sampleBuf`), `LookGenerator` (опц., сверка SHA) → `C/Look/*.swift`; `merge()` → `C/Mesh/MeshKit.swift` | `LookResources` (текстуры, сэмплеры) → `R/Look/LookResources.swift`; `Shaders/Common/Look.h`, `Fog.h`, `Shaders/Common/Keyline.metal`; canvasTexture → `R/Textures/DecalLibrary.swift` |
| `core/math.js` | `Mulberry32`, `Simplex2D`, `fbm2`, `MathUtil` (clamp/lerp/smoothstep/damp/dampAngle/wrapAngle) → `C/Math/Rng.swift`, `C/Math/Noise.swift`, `C/Math/MathUtil.swift` | `GLSL_NOISE` → `Shaders/Common/Noise.h` |
| `core/settings.js` | `Settings`, `SettingsDefaults`, `ProgressStore` (протокол хранилища) → `C/Core/Settings.swift` | `UserDefaultsSettingsStore` → `A/Persistence/UserDefaultsStore.swift` |
| `core/stubs.js` | протоколы `WeatherAPI`…`PostAPI`, `StubSystems` → `C/Core/SystemProtocols.swift`, `C/Core/StubSystems.swift` | — |
| `core/warmup.js` | `WarmupState` (в `Game.swift`) | `PipelineCache.precompile` → `R/Core/PipelineCache.swift` |
| `core/weathering.js` | `WearPresets` (данные) → `C/Data/Schemas/LookData.swift` | `Shaders/Common/Weathering.h`, `WxParams` в `ShaderTypes.h` |
| `systems/post.js` | `PostState` (импульсы, экспозиция, грейдинг → `FinalUniformsCPU`), `DynResController` → `C/Post/PostState.swift`, `C/Post/DynRes.swift` | `PostChain`, `BloomPass`, `CompositeOutputPass` → `R/Post/*.swift`; `Shaders/Post/Bloom.metal`, `Output.metal` |
| `post/finalShader.js` | дефолты → `post.json` | `FinalPass` → `R/Post/FinalPass.swift`, `Shaders/Post/Final.metal` |
| `post/drops.js` | `LensDrops` (448 ячеек, SoA, Double→Float) → `C/Post/LensDrops.swift` | загрузка в кольцевой буфер в `FinalPass` |
| `post/thermal.js` | `ThermalState` (boot/flick/mix, LCG 1234567) → `C/Post/Thermal.swift` | `HeatPass` → `R/Post/HeatPass.swift`, `Shaders/Post/Heat.metal` |
| `post/photo.js` | `PhotoModeState` → `C/Post/PhotoMode.swift` | `FrameCapture` → `R/Post/FrameCapture.swift`; `PhotoSaver` → `A/Platform/PhotoSaver.swift`; `PhotoOverlay` → `U/Screens/PhotoOverlay.swift` |
| `index.html` | — | `MaydayIOSApp`/`MaydayMacApp` → `AppIOS/`, `AppMac/`; `RootView`, `BootView`, `FatalView` → `A/RootView.swift`; LaunchScreen |
| `style.css` | токены → `hud_tokens.json` | `Theme` → `U/Theme/Theme.swift` |

**Океан и погода**

| Веб | Core | Render |
|---|---|---|
| `systems/ocean.js` | `OceanSim` (фокус, снап сетки, сплэши 24, глинты top‑8, searchlight, downwash, стампы, следы, полосы, мели, `OceanUniformsCPU`) → `C/Ocean/OceanSim.swift` | `OceanRenderer` → `R/Ocean/OceanRenderer.swift` |
| `ocean/coast.js` | `CoastMap` (бейк, chamfer, `coastDistance`, `coastDamp`) → `C/Ocean/CoastMap.swift` | загрузка `r8Unorm` в `OceanRenderer` |
| `ocean/features.js` | `FeatureSet` → `C/Ocean/FeatureSet.swift` | `Shaders/Ocean/OceanFeatures.h` |
| `ocean/grid.js` | `OceanGrid` → `C/Ocean/OceanGrid.swift` | статические буферы по уровню качества |
| `ocean/material.js` | `oceanDefines` → function constants | `OceanPipeline` → `R/Ocean/OceanPipeline.swift`; `OceanUniforms` в `ShaderTypes.h` |
| `ocean/memory.js` | `WaterMemoryQueue` (≤ 128 стампов, recentre, decay) → `C/Ocean/WaterMemory.swift` | `WaterMemoryPass` → `R/Ocean/WaterMemoryPass.swift`, `Shaders/Ocean/WaterMemory.metal` |
| `ocean/selftest.js` | `OceanInversionTests` (XCTest) | `OceanSelftest` (compute) → `R/Ocean/OceanSelftest.swift`, `Shaders/Ocean/OceanSelftest.metal` |
| `ocean/shaders.js` | — | `Shaders/Ocean/Ocean.metal`, `OceanCommon.h`, `OceanSurface.h`, `OceanFinal.h` |
| `ocean/waves.js` | `WaveBank` → `C/Ocean/WaveBank.swift` | — |
| `systems/weather.js` | `WeatherSim`, `WeatherFrame` (POD для рендера) → `C/Weather/WeatherSim.swift` | `WeatherBridge` (fog, clear, exposure, свет) → `R/Weather/WeatherBridge.swift` |
| `weather/endless.js` | `EndlessPlanner` → `C/Weather/EndlessPlanner.swift` | — |
| `weather/env.js` | `EnvRebakePolicy` → `C/Weather/EnvPolicy.swift` | `EnvironmentProbe` → `R/Lighting/EnvironmentProbe.swift`, `Shaders/Lighting/EnvSky.metal`, `Prefilter.metal` |
| `weather/gusts.js` | `GustFronts` → `C/Weather/GustFronts.swift` | (uniforms `uGustFronts`) |
| `weather/lightning.js` | `LightningSim` → `C/Weather/Lightning.swift` | — |
| `weather/lights.js` | `SunRig` → `C/Weather/SunRig.swift` | `LightRig`, `ShadowPass` → `R/Lighting/*.swift`, `Shaders/Lighting/ShadowDepth.metal` |
| `weather/palette.js` | `PaletteCodec` (pack/blend/green/unpack) → `C/Weather/Palette.swift` | — |
| `weather/presets.js` | данные `weather.json` → `C/Data/Schemas/WeatherData.swift` | — |

**Мир, опасности, эффекты**

| Веб | Core | Render |
|---|---|---|
| `systems/world.js` | `World` (pads, `padAt`/`deckAt`/`nearestPad`, препятствия, env, каналы ламп, мели) → `C/World/World.swift`, `C/World/Pads.swift`, `C/World/LampChannels.swift` | `WorldRenderer` → `R/World/WorldRenderer.swift` |
| `world/boats.js` | `Boats` (Navigator, VesselMotion, wake‑триггеры) → `C/World/Boats.swift` | baked `boat_*.mmesh` |
| `world/contact.js` | `CollarList` → `C/World/Collars.swift` | `CollarBatch` → `R/World/CollarBatch.swift`, `Shaders/Water/Collars.metal` |
| `world/decals.js` | — | baked PNG; `DeckDecalPainter` (CoreText‑фолбэк) → `R/Textures/DeckDecalPainter.swift` |
| `world/floaters.js` | `Floaters` (раскладка mulberry32(seed+777), ритмы буёв, дрейф) → `C/World/Floaters.swift` | `FloaterBatches` → `R/World/FloaterBatches.swift` |
| `world/geo.js` | `WorldGeo` (rng, h3/fbm3, `deckAt`/`halfBeamAt` корпусов) → `C/World/WorldGeo.swift` | геометрия baked |
| `world/lamps.js` | `LampRegistry` → `C/World/Lamps.swift` | `LampBatch` → `R/World/LampBatch.swift`, `Shaders/World/Lamp.metal` |
| `world/landforms.js` | `Landforms` (`islandDef`, `rockDef`, колонны, `fitShoals`) → `C/World/Landforms.swift` | `TerrainRenderer` → `R/World/TerrainRenderer.swift` |
| `world/lighthouse.js` | `Lighthouse` → `C/World/Places/Lighthouse.swift` | `PlaceViews` (луч, лампы) → `R/World/PlaceViews.swift`; baked `lighthouse_{q}.mmesh` |
| `world/materials.js` | таблица CH → `world.json` | `Shaders/World/Prop.metal`, `Lamp.metal`, `Beam.metal`; `WorldUniforms` в `ShaderTypes.h` (flame — мёртвый код, не портируется) |
| `world/rig.js` | `Rig` → `C/World/Places/Rig.swift` | `Shaders/World/Flare.metal` (licks + plume); baked `rig.mmesh` |
| `world/rigging.js` | `Windsock`, `RiggingList` → `C/World/Rigging.swift` | instanced‑палки на Prop‑пайплайне |
| `world/ship.js` | `Ship` → `C/World/Places/Ship.swift` | `Shaders/World/GreenWater.metal`; baked `ship_arktur.mmesh` |
| `world/terrain.js` | `Terrain` (hashi/noise2/fbm2/ridged2, `makeHeightFn`, `buildTerrain`, сэмплер, колонны, мели, валуны, `coverRule`) → `C/World/Terrain/*.swift` | меш строится в Core (`TerrainMesh`), загружается в Render |
| `world/terrainMaterial.js` | `RockTexture` (генератор; ship bytes) → `C/World/RockTexture.swift` | `Shaders/World/Terrain.metal` (FC `TERRAIN_LQ`) |
| `world/vegetation.js` | `VegetationScatter` → `C/World/Vegetation.swift` | `Shaders/World/Vegetation.metal` (+ depth); baked `veg_atlas.png`, `veg_*.mmesh` |
| `world/vessel.js` | `VesselMotion`, `Navigator` → `C/World/Vessel.swift` | генераторы декора — baked |
| `systems/hazards.js` | `Hazards` (spawn, эвикция, schedule, `_random`, `_pickSpot`, `forceAt`/`surfaceFlowAt`/`waveLiftAt`/`dangerAt`/`imminent`, rig air, green sky, hail) → `C/Hazards/Hazards.swift` | `HazardsRenderer` → `R/Hazards/HazardsRenderer.swift` |
| `hazards/cells.js` | `Downburst`, `HailCell` → `C/Hazards/Cells.swift` | — |
| `hazards/charges.js` | `Charges` → `C/Hazards/Charges.swift` | — |
| `hazards/common.js` | `HazardTables`, `rankine`, `fromPhrase`/`bearingDeg`/`metres` → `C/Hazards/HazardCommon.swift` | `Shaders/Hazards/HZ.h`, генераторы `quad`/`polarDisc`/`cylinderGrid` → `C/Mesh/MeshKit.swift` |
| `hazards/curtains.js` | `CurtainSlots` (6) → `C/Hazards/Slots.swift` | `Shaders/Hazards/Curtains.metal` |
| `hazards/debris.js` | `DebrisPool` (CAPS 48/16/6/2) → `C/Hazards/Debris.swift` | baked `debris_*.mmesh`, ThreePBR plain |
| `hazards/rogue.js` | `Rogue` → `C/Hazards/Rogue.swift` | `Shaders/Hazards/Rogue.metal` (sheet + veil) |
| `hazards/spout.js` | `Spout` (5 стадий, торнадо‑экстры) → `C/Hazards/Spout.swift` | — |
| `hazards/vortexfx.js` | `VortexSlots` (8, видимы геймплею) → `C/Hazards/Slots.swift` | `Shaders/Hazards/Vortex.metal` (funnel/collar/shadow/spray) |
| `hazards/waterrings.js` | `WaterRings` (конформация по `heightAt`) → `C/Hazards/WaterRings.swift` | `Shaders/Hazards/WaterRings.metal` |
| `hazards/whirlpool.js` | `Whirlpool` (engulf по `GroupID`) → `C/Hazards/Whirlpool.swift` | — |
| `systems/fx.js` | `Effects` (API splash/spray/smoke/sparks/flare/burst/steam/bolt/acquireLight, downwash, слоты дыма) → `C/FX/Effects.swift` | `FxRenderer` → `R/FX/FxRenderer.swift` |
| `fx/common.js` | `FxTables`, `strokeEnvelope`, `softEnvelope`, `isOrange` → `C/FX/FxCommon.swift` | `Shaders/FX/Air.h` (отдельно от HZ.h: другие константы) |
| `fx/gusts.js` | `GustStreakSlots` → `C/FX/GustStreaks.swift` | `Shaders/FX/GustStreaks.metal` |
| `fx/life.js` | `GullFlocks` (гейт подсказки и якоря — геймплей), `MarineLife` (косметика) → `C/FX/Life.swift` | `Shaders/FX/Life.metal` (gull flap + depth, jellies, whale shade) |
| `fx/lightning.js` | `BoltGenerator` → `C/FX/LightningFx.swift` | `Shaders/FX/Lightning.metal` |
| `fx/lightpool.js` | `LightPool` (4 физических, гистерезис 1,35) → `C/FX/LightPool.swift` | `point[2..5]` в `LightsUniforms` |
| `fx/particles.js` | `ParticlePool` (кольца рождений, пресеты) → `C/FX/Particles.swift` | `ParticleRenderer` → `R/FX/ParticleRenderer.swift`, `Shaders/FX/Particles.metal` |
| `fx/rain.js` | `RainState` → `C/FX/Rain.swift` | `Shaders/FX/Rain.metal` |
| `fx/signals.js` | `SignalFx` (фальшфейеры 8, ракеты 4, «ракета в объектив») → `C/FX/Signals.swift` | `Shaders/FX/Signals.metal` (glow, rings), heat‑прокси |
| `fx/sky.js` | `SkyLayers` → `C/FX/Sky.swift` | `Shaders/FX/Sky.metal` (scud + shadow, fog layers, glory) |

**Вертолёт, камера, выжившие**

| Веб | Core | Render |
|---|---|---|
| `systems/heli.js` | `Helicopter` (оси, aim/nose, аккумулятор 60 Гц, интерполяция) и `HeliVisualState` (пружины, роторы, uniforms корпуса) → `C/Heli/Helicopter.swift`, `C/Heli/HeliVisualState.swift` | `HeliRenderer` → `R/Heli/HeliRenderer.swift` |
| `heli/flight.js` | `FlightModel` → `C/Heli/FlightModel.swift` | — |
| `heli/ops.js` | `HeliOps` (`DamageSource` enum вместо регэкспов) → `C/Heli/HeliOps.swift` | — |
| `heli/winch.js` | `Winch`, `CableVerlet` (Float‑хранение) → `C/Heli/Winch.swift` | `CableRenderer` → `R/Heli/CableRenderer.swift`; `Shaders/Heli/Cable.metal`, `Ring.metal` |
| `heli/materials.js` | дефолты → `heli.json` | `Shaders/Heli/Hull.metal`, `Rotor.metal`, `Lights.metal`, `Cone.metal` |
| `heli/model.js` | `HeliModel` (POINTS, ROTOR_R, SKID_Y, CH) → `C/Heli/HeliModel.swift` | baked `heli_*.mmesh` |
| `heli/shapes.js` | — (только инструмент бейка) | — |
| `heli/decals.js` | — | baked `heli_livery.png` |
| `heli/lights.js` | `HeliLights` (строб, маяк, nav, St. Elmo, глинты) → `C/Heli/HeliLights.swift` | `point[0]` + `uChan`/`uGlow*` |
| `heli/searchlight.js` | `Searchlight` (`heli.beam`) → `C/Heli/Searchlight.swift` | `spot[0]` + Cone‑проход |
| `heli/crewman.js` | `CrewmanIK` → `C/Heli/Crewman.swift` | baked `heli_crew_*.mmesh` |
| `systems/camera.js` | `CameraRig`, `Projection` (GL‑конвенции, `worldToScreen`/`screenToWater`) → `C/Camera/CameraRig.swift`, `C/Camera/Projection.swift` | `CameraMatrices` (GL → Metal) → `R/Core/CameraMatrices.swift` |
| `camera/shake.js` | `CameraMotion` → `C/Camera/CameraMotion.swift` | — |
| `camera/freecam.js` | `FreeCam` → `C/Camera/FreeCam.swift` | `PhotoGestures` → `A/Input/PhotoGestures.swift` |
| `systems/survivors.js` | `Survivors`, `Detection`, `Warmth`, `SurvivorCheckpoint` (Codable) → `C/Survivors/*.swift` | `SurvivorsRenderer` → `R/Survivors/SurvivorsRenderer.swift` |
| `survivors/bottle.js` | `Bottle` → `C/Survivors/Bottle.swift` | baked `bottle_*.mmesh` |
| `survivors/carriers.js` | `Carrier` (ID из пула миссии, фазы из RNG миссии) → `C/Survivors/Carrier.swift` | — |
| `survivors/craft.js` | размеры → `survivors.json` | `CraftBatch` → `R/Survivors/CraftBatch.swift`; `Shaders/Survivors/Craft.metal`; baked `craft_*.mmesh` |
| `survivors/crowd.js` | константы тела → `survivors.json` | `CrowdRenderer` → `R/Survivors/CrowdRenderer.swift`; `Shaders/Survivors/Person.metal` (+ `Pose.h`, ghost, keyline) |
| `survivors/geo.js` | `MeshKit.mergeParts` (если понадобится) | `InstanceCulling` → `R/Scene/InstanceCulling.swift` |
| `survivors/heat.js` | `thermalBoost`, значения heat → `C/Survivors/Heat.swift` | `HeatProxyBatch` → `R/Survivors/HeatProxyBatch.swift` |
| `survivors/people.js` | `FallbackPeople`, `RussianMorph` → `C/Survivors/People.swift`, `C/Text/RussianMorph.swift` | — |
| `survivors/poses.js` | `Poses` → `C/Survivors/Poses.swift` | — |
| `survivors/signals.js` | `SignalDesk` → `C/Survivors/SignalDesk.swift` | — |
| `survivors/tables.js` | данные `survivors.json` → `C/Survivors/SurvivorTables.swift` | — |
| `survivors/water.js` | push‑списки коллар, свечений, линий → `C/Survivors/WaterContacts.swift` | `Shaders/Water/Collars.metal` (свой фрагмент), `Shaders/Water/Glows.metal`, линии |

**Миссия, радио, звук**

| Веб | Core / Synth | Apple |
|---|---|---|
| `systems/mission.js` | `MissionDirector`, `ScriptRunner`, `CheckpointManager` → `C/Mission/*.swift` | — |
| `mission/campaign.js` | `campaign.json` → `C/Mission/CampaignData.swift` (Codable) | — |
| `mission/prepare.js` | `prepareDef`, `cardLine`, `todaySeed` (инжектируемый часы) → `C/Mission/Prepare.swift` | — |
| `mission/manifest.js` | `Manifest.makePeople`, `quoteFor`, `guessGender` → `C/Mission/Manifest.swift` | — |
| `mission/ledger.js` | `Ledger` → `C/Mission/Ledger.swift` | — |
| `mission/scoring.js` | `Scorer`, `medalsFor` → `C/Mission/Scorer.swift` | — |
| `mission/progress.js` | `CareerProgress` → `C/Mission/Progress.swift` | хранилище — `A/Persistence` |
| `mission/onboarding.js` | `Onboarding` → `C/Mission/Onboarding.swift` | глифы контроллеров → `A/Input/ControllerGlyphs.swift` |
| `mission/endless.js` | `ShiftGenerator` → `C/Mission/Shift.swift` | — |
| `mission/objectives.js` | `Objectives` → `C/Mission/Objectives.swift` | — |
| `mission/report.js` | `ReportBuilder` (ремарки — упорядоченные предикаты Swift) → `C/Mission/Report.swift` | — |
| `mission/text.js` | `RuText` → `C/Text/RuText.swift` | — |
| `mission/checkpoint.js` | `HazardSnapshot` (Codable на тип опасности) → `C/Hazards/HazardSnapshots.swift` | — |
| `systems/radio.js` | `Radio` (очередь, приоритеты, кулдауны, UTF‑16 длина) → `C/Radio/Radio.swift` | — |
| `radio/catalogue.js` | `radio.json` → `C/Radio/Catalogue.swift` | — |
| `radio/triggers.js` | `RadioTriggers` → `C/Radio/RadioTriggers.swift` | — |
| `radio/words.js` | `RuWords` (оба варианта COLLECTIVE и peopleWords) → `C/Text/RuWords.swift` | — |
| `systems/audio.js` | `AudioDirector` → `S/AudioDirector.swift` | `AudioHost` → `MaydayAudio/AudioHost.swift` |
| `audio/graph.js` | `AudioGraph`, `Mixer`, `VoicePool`, `emitterLaw` → `S/Graph/*.swift`; ноды → `CMaydayDSP/*.c` | — |
| `audio/dsp.js` | `DSPResources` → `S/DSPResources.swift` | — |
| `audio/rotor.js` | `RotorSound` → `S/Sounds/RotorSound.swift` | — |
| `audio/environment.js` | `EnvironmentSound` → `S/Sounds/EnvironmentSound.swift` | — |
| `audio/voice.js` | `RadioVoice` → `S/Sounds/RadioVoice.swift` | — |
| `audio/alarms.js` | `Alarms` → `S/Sounds/Alarms.swift` | — |
| `audio/music.js` | `MusicDirector` → `S/Sounds/Music.swift` | — |
| `audio/winch.js` | `WinchSound` → `S/Sounds/WinchSound.swift` | — |
| `audio/sfx.js` | `SfxLibrary` → `S/Sounds/Sfx.swift` | — |
| `audio/extras.js` | `ExtrasSound` → `S/Sounds/Extras.swift` | — |

**HUD и интерфейс**

| Веб | Core | UI / Render / App |
|---|---|---|
| `systems/hud.js` | `ScreenStack`, `ModeRouter`, гейты, swallow/consumed, `capturingBack` → `C/HUD/ScreenStack.swift` | `HudCoordinator` → `U/HudCoordinator.swift` |
| `ui/hud.css` | — | `Theme`, `HudStyle` (+ `hud_tokens.json`) → `U/Theme/*.swift` |
| `ui/common/chart.js` | `ChartModel` (глубины, marching squares, промеры, карандаш, фронты, wind barb) → `C/HUD/Chart/ChartModel.swift` | `ChartPainter` (CoreGraphics) → `U/Chart/ChartPainter.swift` |
| `ui/common/dom.js` | `Ticker`, `Diffed<T>` → `C/HUD/Ticker.swift` | — |
| `ui/common/fmt.js` | `RuFormat` (Intl ru‑RU вручную), `JSNumber` → `C/Text/RuFormat.swift` | — |
| `ui/common/fonts.js` | `HudFontID` → `C/HUD/HudFonts.swift` | `GlyphAtlas` → `R/Hud/GlyphAtlas.swift` |
| `ui/common/icons.js` | `KeycapMarkup` (`withKeycaps`) → `C/HUD/KeycapMarkup.swift` | SVG в `Assets.xcassets` (`icons.json`) → `U/Theme/Icons.swift` |
| `ui/common/keys.js` | `KeyLabels` → `C/Input/KeyLabels.swift` | — |
| `ui/common/nav.js` | `MenuModel` → `C/HUD/MenuModel.swift` | — |
| `ui/common/palette.js` | `HudPalette` → `C/HUD/HudPalette.swift` | — |
| `ui/common/transition.js` | `StaticTransition` (тайминг) → `C/HUD/StaticTransition.swift` | `Shaders/UI/Static.metal` |
| `ui/common/typewriter.js` | `Typewriter` (UTF‑16) → `C/HUD/Typewriter.swift` | — |
| `ui/flight/flight.js` | `FlightHud` (композитор, проводка событий → тосты), `HudLayout` → `C/HUD/Flight/FlightHud.swift`, `HudLayout.swift` | `FlightHudRenderer` → `R/Hud/FlightHudRenderer.swift` |
| `ui/flight/hints.js` | `HintBubble` → `C/HUD/Flight/Hints.swift` | — |
| `ui/flight/map.js` | `TacMapModel` → `C/HUD/Flight/TacMap.swift` | база карты — `ChartPainter` → текстура |
| `ui/flight/model.js` | `HudSnapshot` → `C/HUD/Flight/HudSnapshot.swift` | — |
| `ui/flight/overlay.js` | `OverlayBuilder`, `EdgePlacement` → `C/HUD/Flight/Overlay/*.swift` | `HudKit` → `R/Hud/HudKit.swift`, `Shaders/UI/Hud2D.metal` |
| `ui/flight/panels.js` | `PanelsViewModel` → `C/HUD/Flight/Panels.swift` | — |
| `ui/flight/radar.js` | `RadarModel` → `C/HUD/Flight/Radar.swift` | — |
| `ui/flight/subtitles.js` | `Subtitles` → `C/HUD/Flight/Subtitles.swift` | — |
| `ui/flight/toasts.js` | `ToastQueue` → `C/HUD/Flight/Toasts.swift` | hit‑test кнопки — `A/Input` |
| `ui/flight/touch.js` | `TouchMapping` → `C/Input/TouchMapping.swift` | `TouchControlsView` (UIKit) → `A/Input/TouchControlsView.swift` |
| `ui/flight/warnings.js` | `WarningsModel` (общий с `Alarms`) → `C/HUD/Flight/Warnings.swift` | — |
| `ui/flight/winch.js` | `WinchPanelModel` → `C/HUD/Flight/WinchPanel.swift` | — |
| `ui/screens/screen.js` | `ScreenID` | `ScreenView` → `U/Screens/Screen.swift` |
| `ui/screens/boot.js` | гейт `seenFlashWarning` | `FlashWarningScreen` → `U/Screens/BootScreens.swift` (PressScreen удалён, §10) |
| `ui/screens/title.js` | `TitleViewModel` (телекс) → `C/HUD/Screens/TitleVM.swift` | `TitleScreen` → `U/Screens/TitleScreen.swift` |
| `ui/screens/operations.js` | `OperationsVM` → `C/HUD/Screens/OperationsVM.swift` | `OperationsScreen` |
| `ui/screens/briefing.js` | `BriefingVM` (классификация фронта, расписание карандаша) → `C/HUD/Screens/BriefingVM.swift` | `BriefingScreen` |
| `ui/screens/pause.js` | `PauseVM` → `C/HUD/Screens/PauseVM.swift` | `PauseScreen` |
| `ui/screens/settings.js` | `SettingsSchema` → `C/HUD/Screens/SettingsVM.swift` | `SettingsScreen` |
| `ui/screens/controls.js` | `Rebinder` (`_assign`) → `C/Input/Rebinder.swift` | `ControlsScreen` |
| `ui/screens/debrief.js` | `DebriefTimeline` → `C/HUD/Screens/DebriefVM.swift` | `DebriefScreen` |
| `ui/screens/confirm.js` | — | `ConfirmDialog` |
| `ui/screens/note.js` | — | `NoteScreen` |
| `src/CONTRACT.md`, `rescue/DESIGN.md` | → `events.json`, протоколы `SystemProtocols.swift`, этот план | справочник; ссылки на §§ в комментариях |

---

## 3. Шейдеры

### 3.1 Правила переноса GLSL → MSL

1. **Один заголовок `GL.h`** с функциями GL‑семантики:
   - `glMod(x, y) = x − y·floor(x/y)` (не `fmod`);
   - `glSmoothstep(e0, e1, x)` по формуле (в том числе для e0 > e1: конденсат `smoothstep(r, 0.55r, d)`);
   - `glDFdy = −dfdy`;
   - `rtUV`, `fragCoordGL`;
   - `glAtan(y, x) = atan2(y, x)`;
   - `sq(x) = x*x`.
2. **`pow(x, 2.0)` с возможным отрицательным основанием** — всегда `sq()`. Это 14 мест в `ocean/shaders.js` и `memory.js` плюс `lookFront` в `look.js`; в вебе исправить тоже (W7). `pow(0, y)` защищается.
3. **Implicit‑LOD выборки** (`texture2D`) внутри ветвлений и циклов (features, downwash, coast surf, glints) поднимаются из ветвей или заменяются на `level`/`gradient`. Иначе в MSL производные не определены.
4. **`oceanVertex`:** точные `precise::sin/cos` — фазы доходят до ~400 рад у края сетки.
5. **Fast‑math выключен** (`MTL_FAST_MATH = NO`), как у ANGLE. Половинная точность (`half`) разрешена только в цветовой части поста и океана после того, как «золотые» кадры проходят (M9).
6. **Сохраняются имена uniform из GLSL.** Каждая функция MSL получает комментарий `// port: rescue/src/...:line`.
7. **Эталон для портирования — полностью собранный GLSL каждой программы** из Chromium (`tools/export/dump-glsl.mjs` → `Reference/glsl/*.vert|frag`, плюс `Reference/programs.json` с ключами кэша программ). Порт сверяется со «склеенным» текстом, а не с исходниками и патчами.

### 3.2 Замена чанков three.js (`onBeforeCompile` → хуки)

Каждое семейство — рукописная MSL‑пара. Она вызывает общие функции в том же порядке, в котором three собирает программу. Точки инъекции `onBeforeCompile` становятся inline‑хуками семейства (`struct PropHooks`, `OceanHooks`…).

| Чанк three r185 | MSL (заголовок → функция) | Кто патчит в вебе (→ хук) |
|---|---|---|
| `common` | `Common.h` | ocean (`OCEAN_COMMON`), prop, terrain, veg, craft, person |
| `begin_vertex`, `beginnormal_vertex`, `defaultnormal_vertex` | `ThreeVertex.h: objectPosition/objectNormal/transformNormal` (+ правило нормалей инстанса) | ocean (`oceanVertex`), gull flap, crowd pose, craft flutter/debris |
| `project_vertex`, `worldpos_vertex` | `ThreeVertex.h: project()` | vegetation (sway/flagging), crowd |
| `shadowmap_pars/vertex` | `Shadow.h: shadowCoord(worldPos + n·normalBias)` | — |
| `fog_vertex` (патч `vFogOff`) | `Fog.h: fogOffset()` | — |
| `color_fragment`, `map_fragment`, `alphatest_fragment` | `material.sampleAlbedo()` | prop (decal, glow, линзы, мокрые скалы), terrain (вся поверхность), craft, person (палитры) |
| `roughnessmap/metalnessmap_fragment` | `material.roughness/metalness` | weathering (после roughnessmap), prop (aSurf), hull |
| `normal_fragment_begin/maps` | `surfaceNormal()` | ocean (детальные нормали), terrain (`terrBump`), vegetation (мягкие нормали) |
| `emissivemap_fragment` | `material.emissive()` | ocean (`oEmis`), prop (каналы, rim, spills), hull, terrain, craft, person |
| `lights_physical_fragment` (+ clearcoat) | `ThreePBR.h: makePhysicalMaterial()` | hull (clearcoat × aSurf.z) |
| `lights_fragment_begin` | `ThreePBR.h: accumulateDirect(lights, hooks)` | ocean (регэксп: тень → `oShadow`, `cloudMul`, spot × `uSpotWater`, dir → `oSunSpecular`); prop (тень → `propShadow`) → параметры `directHook` |
| `lights_fragment_maps` | `IBL.h: iblIrradiance/iblRadiance` | ocean (irradiance = 0) |
| `lights_fragment_end` | `ThreePBR.h: finishIndirect()` + хук | prop/terrain/veg (облачная тень `lookCloud`, AO на indirect), hull (`uSunScale` масштабирует ВЕСЬ direct) |
| `opaque_fragment` | `outgoing()` | ocean (`OCEAN_FRAGMENT_FINAL` перед ним), craft/person (ACES‑защита оранжевого) |
| `tonemapping_fragment`, `colorspace_fragment` | **удаляются**: сцена всегда HDR, ACES и sRGB в composite+output | — |
| `fog_fragment` (патч) | `Fog.h: applyFog()` | — |
| `clipping_planes_fragment` | `discard` dissolve | craft |
| `premultiplied_alpha` | blend‑state + premultiply | vortex shadows, scud shadow, whale shade |

### 3.3 Инвентарь программ → MSL

| # | Источник (веб) | MSL‑файл / функции | Function constants (варианты) | Особенности |
|---|---|---|---|---|
| 1 | look.js keyline (ShaderMaterial) + crowd keyline | `Common/Keyline.metal` `keyline_vs/fs` | `FC_INSTANCED` | BackSide, сдвиг clip.xy по нормали на `uPx·2·w/uRes` |
| 2 | ocean material+shaders | `Ocean/Ocean.metal` `ocean_vs/ocean_fs` | `OCEAN_WAVES` 4/6/8, `OCEAN_Q` 0/1/2, `OCEAN_RAIN_LAYERS`, `OCEAN_GLINTS` 0/4/8, `OCEAN_MEMORY` | 17 слоёв DESIGN; свой свет; `oInvACES` |
| 3 | ocean/memory advect | `Ocean/WaterMemory.metal` `advect_vs/fs` | — | flip clip‑y; `OceanFeatures.h` |
| 4 | ocean/memory stamp | `Ocean/WaterMemory.metal` `stamp_vs/fs` | — | additive One/One; Kelvin V 19,47° |
| 5 | ocean selftest | `Ocean/OceanSelftest.metal` `ocean_selftest_kernel` | `OCEAN_WAVES` | compute; тот же `oceanVertex()` |
| 6 | weather/env sky + PMREM | `Lighting/EnvSky.metal` `env_sky_kernel`, `Lighting/Prefilter.metal` `ggx_prefilter_kernel` | — | HDR‑диск солнца ×24 → float‑куб |
| 7 | depth (three DepthMaterial, customDepth) | `Lighting/ShadowDepth.metal` `depth_vs`, `depth_alpha_fs` | `FC_INSTANCED`, `FC_ALPHATEST`, `FC_DEFORM` (veg/gull) | normalBias в вершине |
| 8 | world prop (+weathering) | `World/Prop.metal` | `FC_DECAL`, `FC_INSTANCED`, `FC_WX` | aSurf‑контракт; 6 spills; CH‑каналы |
| 9 | world lamp | `World/Lamp.metal` | — | billboard, min px, additive |
| 10 | world beam | `World/Beam.metal` | — | DoubleSide, additive, ≤ 0,5 |
| 11 | world collar (contact.js) | `Water/Collars.metal` `world_collar_fs` | — | depthBias(−2, −4) |
| 12 | rig flame / plume | `World/Flare.metal` `flame_*`, `plume_*` | — | additive / alpha; ручной bubble‑fog |
| 13 | ship green water | `World/GreenWater.metal` | — | alpha ≤ 0,9 |
| 14 | terrain | `World/Terrain.metal` | `TERRAIN_LQ`, `FC_INSTANCED` (валуны) | triplanar, derivative bump |
| 15 | vegetation (×3 + depth) | `World/Vegetation.metal` | `VEG_KIND` 0/1/2, `VEG_VARIANT`, `FC_DEPTH` | alpha‑test с компенсацией мипа |
| 16 | hazards funnel / collar / shadow / spray | `Hazards/Vortex.metal` | — | shadow: multiply premult; spray: cull в вершине |
| 17 | hazards curtains | `Hazards/Curtains.metal` | — | kind 0/1 (дождь/град) uniform‑ветка |
| 18 | rogue sheet / veil | `Hazards/Rogue.metal` | — | `CREST_GLSL` → `Rogue.h` |
| 19 | waterrings glow / foam | `Hazards/WaterRings.metal` | `MAXR` 2/4, `FC_FOAM` | вершины в мировых координатах |
| 20 | debris, dolphins, raft packs, MeshStandard plain | `Common/Standard.metal` | `FC_INSTANCED`, `FC_VCOLOR`, `FC_TRANSPARENT` | без хуков |
| 21 | fx particles spray / smoke / glow | `FX/Particles.metal` | `PARTICLE_KIND` 0/1/2 | аналитическая кинематика; soft push |
| 22 | fx rain + motes | `FX/Rain.metal` | `FC_LOCAL` | wrap вокруг фокуса; ширина ≥ 1,2 px |
| 23 | fx lightning core / halo | `FX/Lightning.metal` | `FC_HALO` | ленты в экранном пространстве |
| 24 | fx gust streaks | `FX/GustStreaks.metal` | — | |
| 25 | fx signals glow / ring | `FX/Signals.metal` | — | звезда / круг; HDR |
| 26 | fx sky scud (+shadow), fog layers, glory | `FX/Sky.metal` | `SCUD_SHADOW` | shadow: multiply, depthTest off |
| 27 | fx life: gull flap (+depth), jellies, whale shade | `FX/Life.metal` | `FC_DEPTH` | gull = ThreePBR + flap |
| 28 | heli hull + hub | `Heli/Hull.metal` | `FC_DECAL` | MeshPhysical + clearcoat; weathering в локальной СК |
| 29 | heli rotor veil | `Heli/Rotor.metal` | — | диски main/tail; свой свет |
| 30 | heli lights | `Heli/Lights.metal` | — | `uChan[10]`; ореолы в view space |
| 31 | heli searchlight cone | `Heli/Cone.metal` | — | аналитическая квадрика, 6 сэмплов, IGN |
| 32 | heli cable | `Heli/Cable.metal` | — | постоянная ширина в px |
| 33 | heli reach ring | `Heli/Ring.metal` | — | пунктир 22 |
| 34 | MeshBasic (heat proxies, flare embers, shadow blades) | `Common/Basic.metal` | `FC_INSTANCED` | |
| 35 | survivors person | `Survivors/Person.metal` `person_vs/fs` | — | `Pose.h` (Родриг); палитры `uSkin[4]`… |
| 36 | survivors ghost | `Survivors/Person.metal` `ghost_vs/fs` | — | подтягивание к камере по глубине |
| 37 | survivors craft | `Survivors/Craft.metal` | `FC_WEAR`, `FC_FOUL`, `FC_DEBRIS`, `FC_LAMPLIFT`, `FC_DOUBLESIDED` | dissolve; FOUL_GLSL |
| 38 | survivors collars / glows / lines | `Water/Collars.metal` `surv_collar_fs`, `Water/Glows.metal`, `Common/Line.metal` | — | depthBias(−4, −4) |
| 39 | thermal heat override | `Post/Heat.metal` | `FC_INSTANCED`, `FC_POINTS` | R = heat, G = mass; discard mass ниже y = 0,05 |
| 40 | bloom high‑pass, blur, composite+output | `Post/Bloom.metal`, `Post/Output.metal` | `KERNEL_RADIUS` 6…22 | ACES Hill + sRGB OETF |
| 41 | FinalPass | `Post/Final.metal` | `FC_THERMAL`, `FC_DOF`, `FC_DROPS` (качество) | ~53 uniform; GL‑хелперы |
| 42 | static transition | `UI/Static.metal` | — | screen blend |
| 43 | HUD 2D | `UI/Hud2D.metal` `stroke`, `fill`, `text`, `blur`, `composite` | — | смешивание в гамма‑пространстве |

Итог: ~43 семейства, ~30 файлов `.metal`. Варианты PSO оцениваются в ~180–220 на уровень качества (sampleCount фиксирован, §0 D11).

### 3.4 Раскладка uniform‑буферов

- **Один заголовок `Shaders/ShaderTypes.h`** (C11 и MSL через `#ifdef __METAL_VERSION__`), импортируется в Swift модулем `MaydayShaderTypes`.
- **Разрешённые типы:** `float`, `int32_t`, `uint32_t`, `simd_float2`, `simd_float4`, `simd_float4x4`. `vec3` упаковывается в `float4` (w — паддинг или упакованный скаляр); `float3` и `packed_float3` в структурах запрещены.
- **Массивы фиксированного размера** из общих `#define`: `MAX_WAVES 8`, `MAX_SPLASHES 24`, `MAX_GLINTS 8`, `MAX_FEATURES 4`, `MAX_SHOALS 8`, `CH_COUNT 24`, `HULL_GLOWS 8`, `MAX_VORTEX 8`, `FX_LIGHTS 4`…
- **Проверки размеров:** `_Static_assert(sizeof(T) == N)` и `offsetof`‑ассерты; в Swift — тест `MemoryLayout<T>.size == N` (`ShaderTypesLayoutTests`).
- **Классы частоты обновления:**

| Класс | Структура (пример) | Где лежит |
|---|---|---|
| Кадр | `FrameUniforms`: view/proj (Metal), viewProj, invViewProj, `cameraPosition`, `uTime`, `uResolution`, fog (color, near, far, focus) | `FrameRing`, buffer index 2 |
| Look | `LookUniforms`: uTime, uWind, uWindOffset, uRain, uWet, uFlash, uNight, uResolution, `uGustFronts[4]`, `uGustFrontsB[4]` | `FrameRing`, index 3 |
| Свет | `LightsUniforms`: dir[1] (+ shadow matrix, bias, radius, intensity), hemi[1], spot[2], point[6], `environmentIntensity` | `FrameRing`, index 4 |
| Материал | `PropMaterial` (`uChan[24]`, rim, cloudK, glow[6], `WxParams`), `OceanUniforms` (~2 КБ, каждый кадр), `HullUniforms`, `FinalUniforms`… | анимируемые — `FrameRing`; статичные — персистентный `MTLBuffer`, перезапись по dirty |
| Объект / инстанс | `ObjectData {float4x4 model; float4 heatMassLayer;}` или массивы инстансов семейства (`CrowdInstance`, `CraftInstance`, `ParticleBirth`, `LampInstance`…) | `FrameRing` (динамические) / персистентные (рождения частиц: кольцо, пишется только при emit) |
| Мелкие (< 4 КБ, на draw) | push‑константы прохода | `setVertexBytes`/`setFragmentBytes` |

- **Индексы привязки** (`enum BufferIndex`/`TextureIndex`/`SamplerIndex` в `ShaderTypes.h`):
  - буферы: 0 vertices, 1 instances, 2 frame, 3 look, 4 lights, 5 material, 6 object, 7 pass;
  - текстуры: 0 atlas, 1 detail, 2 lace, 3 shadow, 4 env, 5+ — материальные (decal, coast, memory, rock, veg atlas…);
  - сэмплеры: 0 repeat‑trilinear‑aniso2 (look), 1 repeat‑trilinear‑aniso1 (копия для океана), 2 clamp‑linear, 3 shadow‑compare, 4 nearest.
- **Per‑instance‑данные читаются из `device`/`constant` буфера по `[[instance_id]]`,** а не через vertex descriptor. Вершинные атрибуты мешей описываются `MTLVertexDescriptor` по заголовку `.mmesh`.

Эскиз:

```c
// Shaders/ShaderTypes.h (эскиз)
#define MAX_WAVES 8
typedef struct {
  simd_float4x4 view, projMetal, viewProj, invViewProj;
  simd_float4   cameraPos;      // xyz, w = near
  simd_float4   fogColorNear;   // rgb (linear), near
  simd_float4   fogFarFocus;    // far, focus.x, focus.z, unused
  simd_float4   timeRes;        // uTime (float32 от Double t), realT, width, height
} FrameUniforms;               // _Static_assert(sizeof(FrameUniforms) == 320)
typedef struct {
  simd_float4 uWaveA[MAX_WAVES];   // Dx, Dz, k, a
  simd_float4 uWaveB[MAX_WAVES];   // b, phase(wrapped), L, align
  /* … ~120 полей ocean/material.js в исходном порядке … */
} OceanUniforms;
```

### 3.5 Варианты и прекомпиляция

- Реестр семейств (`R/Pipelines/PipelineRegistry.swift`) перечисляет все комбинации function constants, допустимые на текущем уровне качества. На старте отдельный тест сверяет его покрытие с `Reference/programs.json`: каждой веб‑программе соответствует семейство и вариант.
- Порядок прекомпиляции: океан, ShadowDepth, Prop, Hull, Person, Craft, Terrain, далее остальные; прозрачные FX — фоном до конца брифинга.

---

## 4. Данные

### 4.1 Инструменты экспорта (`rescue-apple/tools/export/`)

| Инструмент | Среда | Что делает |
|---|---|---|
| `shims/loader.mjs`, `shims/dom.mjs` | Node 22 | ESM‑loader: `three` → `rescue/vendor/three/three.core.min.js` (для ocean — `three.module.min.js`); стабы `window`/`document`/`localStorage`/`matchMedia`/`performance`; детерминированный `Math.random` (mulberry32, сид задаётся в задании) |
| `export-data.mjs` | Node 22 | все `Resources/Data/*.json` кроме браузерных, `manifest.json` |
| `export-textures.mjs` | Node 22 | `Look(7)` → `atlas/detail/lace.rgba`; `rockTexture()` → `rock.rgba`; SHA‑256 |
| `export-vectors.mjs` | Node 22 | все CPU‑векторы `Tests/Vectors/**` (кроме браузерных); фиксированные последовательности dt; стаб‑ctx |
| `audio-traces.mjs` | Node 22 | фейковый `AudioContext`, записывающий топологию и автоматизацию параметров (`Tests/Vectors/audio/traces/*.json`), и буферы `dsp.js` |
| `export-browser.mjs` | Chromium (Playwright, лок `scratchpad/tools/.chromium.lock`) | `hud_tokens.json` (computed styles), Intl‑векторы `text/ru_format.json`, раскладка `hud/layout_*.json`, ширины текста, `world/setup_*`, `ocean/coast_*`, `mission/replay_op1.json` |
| `bake-meshes.mjs` | Chromium | все `.mmesh` (§6) |
| `bake-canvas.mjs` | Chromium | все decal/atlas PNG (§6) |
| `dump-glsl.mjs` | Chromium | `Reference/glsl/*`, `Reference/programs.json` (хук `shaderSource`/`linkProgram`) |
| `render-goldens.mjs` | Chromium (SwiftShader) | `Tests/Goldens/**` PNG + входы (`?dynres=0`, фиксированные сид, состояние, время) |
| `audio-goldens.mjs` | Chromium `OfflineAudioContext` | `Tests/Goldens/audio/*.wav` (48 кГц, сидированный `Math.random`) |
| `bake-icons.mjs` | Node 22 | `icons.json` + `Resources/Icons/*.svg` |
| `fetch-fonts.sh` | shell | шрифты OFL из `github.com/google/fonts` на закреплённом коммите, проверка SHA‑256 |
| `verify.mjs` | Node 22 | пересчёт хешей, сверка `manifest.json`, проверка дрейфа (`git diff --exit-code Resources/Data Tests/Vectors`) |

Команда одна: `node tools/export/run-all.mjs [--browser] [--only=<group>]`. Результат воспроизводим: повторный запуск даёт тот же diff. Временных меток в файлах нет.

### 4.2 JSON‑файлы данных (`Resources/Data/`)

| Файл | Инструмент | Источник (веб) | Содержимое |
|---|---|---|---|
| `manifest.json` | export-data | — | `formatVersion`, `webRevision` (`git rev-parse HEAD`, флаг dirty), список файлов `{path, schema, version, sha256, producer}` (включая `.rgba`, `.mmesh`, PNG) |
| `game.json` | export-data | main.js, CONTRACT | порядок систем, `RUN_WHEN_PAUSED`, режимы, правила dt (cap 0,1), сиды (rng 1337, noise 1337, look 7, post 911, thermal 1234567, weather 4242, survivors 4242, camera 4242), камера (fov 40, near 2, far 1200, старт (0, 220, 60) → 0), правило pixelRatio, уровни качества |
| `events.json` | export-data (парсинг CONTRACT + трасса ключей payload из прогона) | CONTRACT.md, все системы | `[{name, emitter, payload: {field: type}, notes}]` (~60) |
| `settings.json` | export-data | core/settings.js, ui/screens/settings.js | `DEFAULTS` (23 ключа), миграции (`assistExplicit`), `pixelRatioCap`, `detail`, ключи хранилища, схема прогресса, `SECTIONS` экрана (рус. подписи и help) |
| `input.json` | export-data | core/input.js, core/haptics.js, ui/common/keys.js, ui/flight/touch.js, post/photo.js, mission/onboarding.js | `BINDINGS`, `REBINDABLE` (рус.), `PAD` (W3C), небиндимые коды, мёртвая зона и кривая стика, `NAMES`/`NUM` подписей клавиш, `PREFERRED`, раскладка тача, клавиши фоторежима, `haptics.rules` |
| `look.json` | export-data, export-textures | core/look.js, core/weathering.js | GUST/CLOUD scale/drift, туман (30/140/0,6, clamp 0,25), дефолты фронтов (140/500), сиды текстур, `detailMaxSlope` 38.6270549618508, дескрипторы и SHA текстур, keyline‑дефолты, `WEAR`, `DEFAULTS` weathering, цвета (hex + linear) |
| `ocean.json` | export-data | ocean/*.js | `WAVE_L`, `WAVE_DIR_DEG`, `QUALITY`, `GRID_EXTENT/POW`, `SKIRT_ROWS`, `EDGE_FADE`, `FALLBACK_SEA` и палитра, `FLASH_*`, `MEMORY_EXTENT`, `HALF_LIFE`, `MAX_STAMPS`, `SHAPE`, таблица стампов, типы и дефолты фич, `ROGUE_SCAR_LIFE`, константы coast, searchlight 220/320, сплэши, глинты, дефолты uniform |
| `weather.json` | export-data | weather.js, weather/{presets,gusts,lightning,lights,env,endless}.js | `PRESET_NAMES`, `SEVERITY`, `LABELS` (рус.), `BEAUFORT`, `DOUGLAS`, `PRESETS` (сырой hex и числа, включая `sea`/`post`/`detect`), `GREEN_TINT`, `FLASH_*`, `ATTRACT_CYCLE`, фронт/давление/ветер, gusts, lightning (огибающие, лимиты), lights (BOX 250, DIST 520, MAP_SIZE, bias), env (направления блобов, 4 с), endless (CLOCK_RATE, DAY/NIGHT, фазы, вероятности) |
| `palette.json` | export-data | weather/palette.js | `ENTRIES`/`LAYOUT` (72 → `SLOTS` 109), `SLOT_CHANNEL`, `OFF`, `COMPILED[preset]` (linear packed), `GREEN_TARGET`/`GREEN_MUL` |
| `post.json` | export-data | post.js, post/{drops,thermal,photo,finalShader}.js | `SAMPLES`, `MIN_SCALE`, `BLOOM_SCALE`, `MAX_PIXELS`, цвета (linear), таблица импульсов, dynres, ядра и факторы bloom, матрицы ACES, grain 24 Гц; `drops` (сетка 28×16, MAX_R, …); `thermal` (SCALE, BOOT_ON/OFF, SWEEP, MASS_DEFAULT, слои, 0,05, 250/1000); `photo` (GRADES рус., DOF_TAPS, BLUR_STEPS, help‑тексты); `final` (дефолты uniform) |
| `world.json` | export-data | world.js, world/*.js | `SERVICES`, `HEIGHT`, CH‑каналы и параметры ритмов, `KINDS` катеров, константы судна, маяка и буровой (позиции, препятствия, лампы, `GLOW`), `SHAPES`/`MIX`/`BUOY_KINDS`/`BUOY_LIGHT` плавучих объектов, VesselMotion/Navigator, Windsock, таблицы рельефа (`ISLAND_LOBES/FLATS/CUTS/BOUNDS`, `CLEAR`, `PATHS`, `ICE`, `TERRAIN_STEP`, `BOULDER_SEG`, `BOULDERS`, `VEG_COUNTS`, `PREVAIL`), `PALETTE` рельефа, `SURF`/`WEAR_LEVEL` |
| `hazards.json` | export-data | hazards.js, hazards/*.js, mission/checkpoint.js | K, C_WIND, profile, `SPOUT/TORNADO/SATELLITE/ROGUE/WHIRL/DOWNBURST/HAIL`, `ALIAS`, `TYPES`, кулдауны, `QUALITY_K`, `MAX_*` пулов, `COLORS`, `FROM` (рус.), тексты предупреждений, списки полей чекпоинта |
| `fx.json` | export-data | fx.js, fx/*.js | `QUALITY` (бюджеты), `COLORS`, пресеты частиц `P`, флаги, `MAX_SPRAY`, `GULL_PRESETS`, константы сигналов (`FLARE_LIFE` 40, `ROCKET_*`, `LENS_*`), дождь (FALL 9, LEN 1,2, `LOCAL_MAX`), небо (`SCUD_*`, `LAYER_*`), lightpool (4, 1,35), молния (`MAX_SEG`) |
| `heli.json` | export-data | heli.js, heli/*.js | flight (K, C_WIND, A_BASE, пороги посадки и повреждений, кулдауны), ops (`DIFF`, топливо, BINGO, температура, услуги площадок, расходники), winch (`SEGS`… `CAPTURE`, `SNAG_*`), model (`POINTS`, `ROTOR_R`, `TAIL_R`, `SKID_Y`, `CH`, `LIGHT_DEFS`, ливрея), lights (`GAIN`, `BELLY`, `COL`, строб/маяк), searchlight, дефолты материалов, crewman |
| `camera.json` | export-data | camera.js, camera/*.js | `BASE_FOV`, `ZOOMS`, `HELI_SCREEN_Y`, пружины, формулы высоты и наклона, пороги reveal/rogue, `OCT` тряски, freecam (`PITCH_MAX`, `DIST_*`, `SEA_REACH`) |
| `survivors.json` | export-data | survivors.js, survivors/{tables,craft,crowd,carriers,heat,poses,bottle}.js | все таблицы `tables.js`, `SUPINE`, цвета, палитры (порядок фиксирован), `POSE`, размеры RAFT/CONT/PLANE, `DEBRIS_KINDS`, деки носителей, места, значения heat, константы бутылки |
| `names_ru.json` | export-data | mission/manifest.js, survivors/people.js, survivors/bottle.js | `mission`: FIRST_M/F, CHILD_M/F, SURNAMES, THEMES, QUOTES; `survivors`: FIRST_M/F, CHILD, SURNAMES, JOBS, QUOTES; `bottleNotes` (10) |
| `campaign.json` | export-data | mission/campaign.js | вычисленные `CAMPAIGN` (8 + 9★), `ENDLESS`, `TITLE`, `TITLE_CYCLE` (`headingOf` уже посчитан) |
| `mission.json` | export-data | mission/*.js | константы директора (`CINEMATIC_S`…), scoring (`STYLES`, `DIFFICULTY`, `ORDER`, `LABELS`, `CHAIN_WINDOW`), `RANKS`, `FAIL_TEXT`, `MEDAL_LABEL`, `REMARKS` (speaker, name, text, `ruleId`), onboarding (`HINTS`, `PRIORITY`, `QUEUE_TTL`), веса endless, константы ledger, `MUST_TYPES`, `MONTHS` |
| `text_ru.json` | export-data | mission/text.js, radio/words.js, ui/common/fmt.js | PRESETS (экипажные названия, главы, видимость), DOUGLAS, BEAUFORT, GROUP_WORDS, квадраты, числительные (оба варианта COLLECTIVE), CLOCK_WORDS, C8/FROM8/TO8, PRESET_SHORT/LABEL/SEVERITY, GROUP |
| `radio.json` | export-data | radio.js, radio/{catalogue,triggers}.js, ui/flight/subtitles.js | `LINES` (~70), `SPEAKER_DEFAULTS`, `DESIGN_IDS`, константы очереди, триггеров и субтитров (`SPEAKER_COLOR`, `DEFAULT_NAME`, `CHANNEL`) |
| `audio.json` | export-data | audio.js, audio/*.js | `SNAP`, компрессор, лимитер, дакинг, реверб, `MAX_VOICES`, сиды буферов, коэффициенты Kellet, PeriodicWave real/imag, слои ротора, makeup‑гейны окружения, `PRIO` и паттерны алармов, прогрессии музыки, форманты голоса (`F0`, `VOWEL`, `FRIC`, `PLOSIVE`), `BELL_STEPS`, `MODES`, константы extras, проводка событие → звук, имена `play()` |
| `hud.json` | export-data | ui/flight/*.js, ui/common/{palette,chart}.js, ui/screens/*.js | палитры (`BASE`, `COLORBLIND`, `NIGHT_AMBER`, `PAPER`), константы раскладки, каденции, overlay (`FOOT`, дэши, `EDGE_*`, `TICKS`, `WAVE_N`), радар, карта, предупреждения (`DEFS`, пороги, строки), панели (строки, `KB_HINTS`, подписи геймпада), тосты (событие → шаблон), лебёдка, chart (`LEVELS`, цвета, острова, `BG_DEF`), `WIND` по пресетам, строки экранов |
| `hud_tokens.json` | export-browser | ui/hud.css, style.css | CSS‑переменные, шрифты и веса, размеры панелей при hs = 1, брейкпоинты (compact `W<900 \|\| H<500`, portrait), анимации (`name, ms, easing, iterations, reduceMotion/reduceFlash‑замена`), сплэш |
| `icons.json` | bake-icons | ui/common/icons.js | `{name: {viewBox, size, svg}}`, `MEDAL_COLOR` |

### 4.3 Конвенции схем

- **Обёртка:**

  ```json
  {"schema":"mayday.<name>","version":1,"source":{"files":["rescue/src/..."],"webRevision":"<sha>"},"producer":"tools/export/<tool>","data":{...}}
  ```

- **Ключи** — camelCase как в JS. Константы в UPPER_CASE сохраняются как есть (`WAVE_L`).
- **Числа:**
  - JSON‑числа через `JSON.stringify` (кратчайшая обратимая запись), парсинг через `JSONDecoder` Double без потерь;
  - спецзначения строками `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"` через `JSNumberBox`;
  - Float32‑данные пишутся как double, точно равный float.
- **Единицы:** метры, секунды, радианы. Ключи в градусах оканчиваются на `Deg`, в процентах — на `Pct`.
- **Цвета:** `{ "hex": "#RRGGBB", "lin": [r, g, b] }`. `lin` берётся из `THREE.Color` (sRGB → linear); Swift‑конверсия сверяется с ним тестом.
- **Строки:** UTF‑8 NFC, NBSP как ` `, ё сохраняется.
- **Большие массивы** — в бинарных сайдкарах (`.f64`, `.f32`, `.u8`, little‑endian), JSON ссылается на них: `{ "file": "...", "dtype": "f64", "shape": [..], "sha256": "..." }`.
- **Перечисления** — строками (`"rogue"`), не числами, кроме мест, где число уходит в GPU (тогда оба значения).
- **Codable‑структуры Swift** лежат в `MaydayCore/Data/Schemas/*.swift`, по одной на файл; неизвестные ключи игнорируются, отсутствие обязательных — ошибка.

### 4.4 Версионирование и контроль дрейфа

- `version` — целое на файл. Ломающее изменение схемы → `version + 1` и правка Codable‑структуры. В `DataCatalog.required` перечислены ожидаемые версии; несовпадение даёт fatalError в debug и ошибку теста.
- `manifest.json.webRevision` фиксирует коммит веба. В CI джоба `export-drift` (Linux, Node 22 + Chromium) прогоняет экспорт и падает при diff. Значит, при изменении веба реэкспорт обязателен в том же PR.
- Бандлированные данные не мигрируются, только реэкспортируются. Мигрируются лишь пользовательские данные (§4.5).

### 4.5 Пользовательские данные

- `UserDefaults["mayday.settings.v1"]` и `["mayday.progress.v1"]` — JSON‑строки той же схемы, что в localStorage. Загрузчик терпим к мусору, как в вебе.
- Текст «ХРАНИТСЯ В ЭТОМ БРАУЗЕРЕ» заменяется на «ХРАНИТСЯ НА ЭТОМ УСТРОЙСТВЕ» (§10).

---

## 5. Паритет

### 5.1 Уровни и допуски

| Класс | Примеры | Допуск |
|---|---|---|
| Целочисленное | mulberry32, LCG, `hashi`, сиды `(seed·2654435761)>>>0`, `imul` | побитово |
| JS‑математика | `JS.sin…tanh`, `hypot` | побитово (fdlibm/V8); `pow` — ≤ 1 ulp до порта V8‑алгоритма, затем побитово |
| Детерминированные Double‑конвейеры | палитры, sRGB → linear, выборки атласа, `gustField`/`frontsAt`/`cloudAt`, `WaveBank.heightAt` при фиксированных t и фокусе, `coastDistance`, `prepareDef`, scoring | побитово; при сбое отчёт в ulp. Отступление ≤ 4 ulp только по явному waiver‑списку в тесте |
| Float32‑хранение | капли, кабель, сетки рельефа, трек | побитово (`Float()` в тех же точках) |
| Хаотичные и длинные | полёт > 600 шагов, кабель > 5 с, погода > 2 мин, «Смена» | побитово первые N шагов (полёт 600, кабель 300, погода 3600); далее — `|Δp| ≤ 1e‑6 м`, `|Δv| ≤ 1e‑6 м/с`, плюс совпадение последовательности событий (тайминг ± 1 кадр) |
| Тексты | все строки, числа ru‑RU, плюрализация | побайтно (UTF‑8) |
| GPU‑численное | селф‑тест океана (CPU `heightAt` против GPU‑вершин) | p99 < 5 см, max < 10 см |
| GPU‑кадры, синтетические входы | Bloom, Output, FinalPass, Static | max |Δ| ≤ 3/255, mean ≤ 0,5/255 (зерно и дизеринг закреплены `uSeed`/`uThermT`) |
| GPU‑кадры, сцены | 8 пресетов погоды, op1‑ракурсы | SSIM ≥ 0,92 к Chromium/SwiftShader плюс ревью человеком (SwiftShader ≠ Apple GPU) |
| HUD | геометрия draw‑list; раскладка | ≤ 0,01 px; прямоугольники ≤ 1 px к дампу Chromium |
| Звук: структура | топология графа, автоматизация параметров | точное совпадение списков событий (время ± 1 сэмпл, значения ≤ 1e‑6 отн.) |
| Звук: буферы | шум, IR, Минарт, град, треск, пузыри, PeriodicWave | SHA‑256 Float32 при 48 кГц |
| Звук: рендер | ротор, ветер, голос, алармы, музыка (офлайн) | RMS по окнам 50 мс ± 0,5 дБ, спектральный центроид ± 3 %, LUFS‑I ± 0,5 LU |

### 5.2 Измеренные факты о математике (Node 22.22, Chromium 141, glibc 2.39, Java StrictMath = fdlibm)

400 000 аргументов (диапазоны ±4, ±450, ±5·10⁴, ±0,01) прогнаны побитовым сравнением. Скрипты лежат в `/tmp/claude-0/-home-user-verbario/ee631d4a-dfd6-5bb9-a2d8-4b928c5f0ff2/scratchpad/libm/`.

| Функция | Node 22 vs fdlibm | Node 22 vs glibc | Chromium 141 vs Node 22 | Chromium 141 vs glibc |
|---|---|---|---|---|
| sin / cos / tan | **0** | 2,5 % / 2,5 % / 2,8 % | 2,4 % / 2,5 % | ≈ 0,06 % |
| exp, log, atan, atan2, asin, acos, sinh, tanh, expm1, log1p | **0** | 0,02–18 % | exp/log/atan2: 0 | — |
| pow | 4,4 % | 9,8 % | 9,8 % | **0** |
| hypot | 39 % | 38 % | 0 | — |
| cbrt | 8,4 % | 49 % | — | — |

Выводы, которые закреплены в решениях:

- В Node 22 почти вся математика — это fdlibm, как во FreeBSD msun.
- `Math.hypot` в V8 считается так: максимум модулей, затем сумма Кэхэна от `(a/max)²`, затем `sqrt(sum)·max`. Это воспроизведено в JS и совпало побитово 0/400 000 для 2 и 3 аргументов. Портируется в `CJSMath`.
- `pow`. В игре 51 вызов `Math.pow` и около 30 `**`; `**` равен `Math.pow` (0 расхождений). В Node `pow` не совпадает ни с glibc, ни с fdlibm 5.3. Задача M0: портировать `pow` из исходников V8 (`src/base/ieee754.cc`) для версии V8 в Node 22 и проверить по `math/jsmath_pow.f64`. До этого допуск 1 ulp.
- `cbrt` в игре не используется.
- В Chromium `sin/cos/pow` берутся из glibc (LGPL). Повторять их не нужно: эталоном CPU‑симуляции служит Node. Сама веб‑игра в Chrome, Firefox и Safari уже различается на ulp. Поэтому «паритет» определяется против эталонного движка, а не против каждого браузера.
- Swift на Apple использует libm Apple. Ни один перенесённый расчёт не вызывает `Foundation.sin` и подобные функции: только `JS.sin`. Это правило проверяет SwiftLint (`custom_rules: no_libm_in_core`).

### 5.3 Файлы векторов (`Tests/Vectors/`)

| Файл(ы) | Инструмент | Содержимое | Допуск |
|---|---|---|---|
| `math/jsmath.json` (+ `jsmath_in_a.f64`, `jsmath_in_b.f64`, `jsmath_<fn>.f64` для sin cos tan exp log atan atan2 asin acos sinh tanh expm1 log1p pow hypot hypot3) | export-vectors | 100 000 входов на функцию из тех же диапазонов, выходы Node | побитово (pow — §5.2) |
| `math/jsnumber.json` | export-vectors | `Math.round` (включая ±x.5, −0, 0.49999999999999994), `toUint32`/`toInt32` от больших произведений, `%` со знаком, `String(n)`, `toFixed` | побитово / побайтно |
| `math/rng.json` | export-vectors | mulberry32 для сидов [1, 77, 101, 202, 303, 404, 505, 606, 707, 808, 909, 911, 1234, 1337, 4040, 4242, 5521, 5531, 7713, 9173, 12345, 1234567, 4294967295]: первые 1000 `next()`, плюс последовательности `range`/`int`/`pick`/`chance`/`sign`/`gauss`; формулы сидов миссий (`seed·7919+13`, `(seed^0x5eed)+1`, `seed·2246822519+77`, `seed·31+7`, `seed·2654435761+977`, `seed+4242`, `seed·97+13`, `seed+777`, `seed·31+5`) | побитово |
| `math/lcg.json` | export-vectors | LCG `(s·1664525+1013904223)>>>0` (detail, thermal, selftest, chart), `1103515245/12345` (transition), сиды и 1000 шагов | побитово |
| `math/noise.json` (+ `.f64`) | export-vectors | `createNoise2D` для сидов 1337, 2024, 4242, 5531, 9173 на сетке 64×64 в [−300, 300] (шаг 9,37), `fbm2`; GLSL‑`hash12`/`vnoise` в Float32 (CPU‑эталон для MSL‑теста) | побитово / ≤ 1e‑6 |
| `math/util.json` | export-vectors | `damp`, `dampAngle`, `wrapAngle`, `smoothstep` (обе сигнатуры), `clamp`, `remap`: граничные случаи | побитово |
| `look/textures.json` | export-textures | SHA‑256 atlas, detail, lace, rock; 1000 точек `sampleAtlas`/`sampleLace`/`sampleDetail` | побитово |
| `look/fields.json` (+ `.f64`) | export-vectors | `gustField`, `frontsAt`, `cloudAt` на сетке 64×64 (±2000 м) × 4 `windOffset` × 3 набора фронтов | побитово |
| `weather/palette.json` | export-vectors | sRGB → linear всех hex пресетов, `blendPacked`/`applyGreen`/`unpack` на сетке t по каналам | побитово |
| `weather/run_calm_to_storm.json`, `run_night_storm.json`, `run_fog.json`, `run_attract.json` | export-vectors | стаб‑ctx, dt = 1/60, 60 с, скриптованная траектория вертолёта: каждые 6 кадров `state` (поднабор полей, включая `windDir`, `gustFronts`, `flash`, `pressure`, `wet`, палитру), лог событий | хаос‑класс (3600 шагов побитово) |
| `weather/endless_20min.json` | export-vectors | `EndlessPlanner` с сидом, 1 Гц: `{t, to, over}`, прогнозы | побитово |
| `weather/gusts.json`, `lightning.json`, `sunrig.json` | export-vectors | спавны порывов, `addWindAt` на сетке; `envelope(t)` и `envelopeReduced(t)`, расписание ударов; `swing`, центр тени, снап | побитово |
| `ocean/wavebank_<preset>.json` (+ `.f64`), 8 пресетов | export-vectors | состояние банка после `update` (seed 101 + 101, snap) и через 30 с плавного перехода; `heightAt`/`normalAt`/`velocityAt` на сетке 41×41 вокруг 3 фокусов камеры при t ∈ {0; 12,5; 600,25}; статистика инверсии; `forward` | побитово |
| `ocean/features.json` | export-vectors | скриптованные `set`/`remove`/`update` FeatureSet; `featureHeightAt`/`flowAt`; pack `uA/uB/uC` | побитово |
| `ocean/uniforms_run.json` | export-vectors | `OceanUniformsCPU` (все поля в порядке JS) на каждом кадре 5‑секундного прогона (стаб‑погода, вертолёт, прожектор) | побитово |
| `ocean/grid.json` | export-vectors | `snapQuantum(N)`, контрольные суммы позиций и индексов сетки для N 160/224/300 | побитово |
| `ocean/coast_<missionId>.json` | export-browser | `{w, h, x0, z0, cell, data(base64)}` и 500 точек `coastDistance` | побитово |
| `world/terrain_<missionId>_<q>.json` (+ `.f32`) | export-vectors | сетки высот, колонны, мели, валуны (`rockDef`, `scatterBoulders`) по каждой миссии с сушей и каждому качеству | побитово |
| `world/setup_<missionId>_<q>.json` | export-browser | после `mission:setup`: pads, obstacles, shoals, раскладка floaters, лампы, коллары | побитово |
| `world/channels.json`, `windsock.json`, `vessel.json` | export-vectors | каналы ламп и `buoyRhythm` по t (включая reduceFlashes); трассы Windsock; VesselMotion и Navigator на реальном WaveBank, dt = 1/60 | побитово / хаос |
| `world/meshkit.json` | export-vectors | контрольные суммы генераторов three, портированных в MeshKit (Plane, Circle, Cylinder open, Sphere, polarDisc, cylinderGrid, `boulderGeometry`) | побитово |
| `hazards/fields.json` | export-vectors | `rankine`, `Downburst.addAir`, `Whirlpool.addFlow`, `Rogue.frame/lift/addFlow`, `Spout.addAir` на сетках | побитово |
| `hazards/traces.json` | export-vectors | Spout: стадии, сила, наклон; `_pickSpot`, `_random` при фиксированном RNG; раскрытие schedule; импакт‑кейсы rogue | хаос‑класс |
| `hazards/strings.json` | export-vectors | `metres`, `fromPhrase`, `bearingDeg`, тексты предупреждений | побайтно |
| `fx/envelopes.json`, `lightpool.json`, `particles.json`, `gulls.json` | export-vectors | `strokeEnvelope`/`softEnvelope`; назначение слотов; CPU‑эталон аналитического интегратора; гейт и якорь чаек | побитово |
| `heli/flight_<scenario>.json`: hover, presets, cruise_wind, assist_off, assist_standard, assist_full, land_pad, land_ship, water_strike, obstacle, autorotation_ditch | export-vectors | вход на каждом шаге 1/60 (`uMove`, `altTarget`, `boost`, wheel) и состояние (`p`, `v`, `heading`, `rpm`, `altTarget`, флаги, события); океан — реальный WaveBank; ветер — реальный WeatherSim | хаос‑класс (600 шагов побитово) |
| `heli/ops.json`, `winch_<scenario>.json` (lower, capture_swimmer, capture_raft, slip, tension, snag), `searchlight.json`, `lights.json` | export-vectors | трассы ops; кабель (Float32) и захват; луч; лампы и строб | побитово / хаос |
| `camera/rig_<scenario>.json`, `projection.json`, `shake.json` | export-vectors | позы CameraRig (follow, winch, crash, reveal, attract) на `realDt`; `worldToScreen`/`screenToWater` (GL) на сетке; слои тряски | побитово / хаос |
| `survivors/people.json`, `poses.json`, `carriers.json`, `run_op1.json` | export-vectors | `makeFallbackPeople`, `feminize`, `guessGender`; `poseTargets` на сетке; `slotFor`/`deckHeightAt`/`raftYaw`; прогон op1 (после W1) | побитово / хаос |
| `mission/prepare.json` | export-vectors | `prepareDef` для 9 операций, endless (сид 20261016) и title | побитово |
| `mission/scoring.json`, `report.json`, `shift.json`, `objectives.json`, `onboarding.json` | export-vectors | цепочки Scorer, таблица `medalsFor`, `buildReport` по записанным состояниям, спавны «Смены» с записанными входами, тексты задач, таймлайн подсказок | побитово / побайтно |
| `mission/replay_op1.json` | export-browser (W2 + W5) | op1 автопрохождением с `?seed`, фиксированным dt и записанными входами: `RawInputFrame` на кадр, трасса событий, состояние миссии на тиках 2 Гц, итоговый отчёт | события и отчёт точно |
| `radio/queue.json`, `triggers.json` | export-vectors | скриптованные `say`/`line` → таймлайн и отброшенные; события и состояния → id и тексты строк | побайтно |
| `text/ru_words.json` | export-vectors | `numberWords` 0…9999, plural 0…200, `squareOf`, секторы, clock, heading digits, `kmWords` | побайтно |
| `text/ru_format.json` | export-browser | Intl ru‑RU из Chromium: `num0`/`num1`/`num1o` (x.x5, отрицательные, −0, 999/1000/9999/10000), `mmss`, `timecode`, `distU`/`distL` (994…1050), `deg3`, compass8, Beaufort/Douglas | побайтно |
| `input/input.json`, `rebind.json`, `haptics.json`; `settings/settings.json` | export-vectors | кривая стика, `applyBindings`, последовательности `poll()`; кейсы `_assign`; правила хаптики; миграции и каскады настроек | побитово |
| `post/state.json`, `drops.json`, `thermal.json`, `photo.json` | export-vectors | `FinalUniformsCPU` и экспозиция по кадрам для сценария (события, погода, вертолёт); ячейки капель после N шагов; машина тепловизора; фоторежим | побитово |
| `hud/palette.json`, `edges.json`, `warnings.json`, `panels.json`, `menu.json`, `chart_<missionId>.json`, `text_widths.json` | export-vectors / export-browser | `HudPalette` по сетке (night, haze, cb); размещение краевых индикаторов; ряды предупреждений; строки и классы панелей; трассы меню; модель карты (V‑сетка, промеры, сегменты, якоря, точки карандаша); ширины строк из `measureText` | побитово / ≤ 0,01 px |
| `hud/layout_1920x1080.json`, `layout_844x390.json` | export-browser | `getBoundingClientRect`, шрифт и цвет каждого элемента HUD в каждом режиме | ≤ 1 px |
| `audio/buffers.json` (+ `.f32`), `laws.json`, `traces/<sound>.json` | export-vectors, audio-traces | SHA и первые 4096 сэмплов каждого буфера при 48 кГц; PeriodicWave; `emitterLaw`, законы ротора, алармов, музыки; трассы графа на звук | §5.1 |

### 5.4 Как XCTest использует векторы

- **`VectorLoader`** (`Core/Tests/MaydayCoreTests/Support/VectorLoader.swift`) находит `Tests/Vectors`, поднимаясь от `#filePath` до каталога с `Resources/Data/manifest.json` (`DataCatalog.locateRoot`). Ресурсы SwiftPM не нужны, и это работает на Linux, macOS и в Xcode. Загрузчик декодирует обёртку и сайдкары (`Data` → `[Double]`/`[Float]`, little‑endian).
- **Ассерты** (`Support/Asserts.swift`):
  - `assertBitEqual(_:_:)`: сравнение `bitPattern` с отчётом первого расхождения (индекс, оба значения, hex, ulp);
  - `assertULP(_:_:max:)`, `assertClose(rel:abs:)`, `assertTraceEqual(prefix:then:tol:)`;
  - `assertEventsEqual` (имена, порядок, тайминг ± 1 кадр).
  - SHA‑256 — своя мини‑реализация в `Support/SHA256.swift` (без CryptoKit и swift‑crypto, для Linux).
- **Шаблон теста:**

  ```swift
  func testWaveBankCalm() throws {
    let v = try VectorLoader.load("ocean/wavebank_calm")
    let bank = WaveBank(data: catalog.ocean); bank.setSeed(v.seed); bank.update(v.palette, t: v.t, dt: v.dt, snap: true)
    for (i, p) in v.grid.enumerated() { assertBitEqual(bank.heightAt(p.x, p.z, t: v.t), v.height[i], "i=\(i)") }
  }
  ```

- **Тест‑планы:**
  - `Core` (Linux + macOS, `swift test --parallel`);
  - `Synth` (Linux + macOS, офлайн‑рендер);
  - `GPU` (macOS и iOS‑устройство: `OceanSelftestTests`, `PostGoldenTests`, `ShaderTypesLayoutTests`);
  - `Perf` (устройство: `XCTMetric`, GPU‑время из счётчиков `MTLCounterSampleBuffer`, 10‑минутный прогон op1 с термосостоянием);
  - `UI` (снапшоты SwiftUI‑экранов).
- **CI:**
  - (1) `linux-core`: docker `swift:6.0-jammy` → `swift build`, `swift test`;
  - (2) `export-drift`: Node 22 + Playwright → `run-all --browser` и `git diff --exit-code`;
  - (3) `apple`: macOS 15 на Apple silicon (self‑hosted Mac mini M1/M2; у облачных macOS‑VM урезанный Metal) → `xcodegen`, `xcodebuild` для iOS и macOS, тест‑планы Core, Synth, GPU (macOS);
  - (4) ночной `device`: iPhone 13 по кабелю → GPU и Perf.

### 5.5 Визуальный и аудио‑паритет

- **«Золотые» кадры** (`render-goldens.mjs`). Синтетические проходы: FinalPass с фиксированными `tDiffuse`/`tHeat`/`tDrops` и наборами uniform, Bloom и Output на HDR‑рампах. Сцены: 8 пресетов × 2 ракурса, op1 (старт, зависание над пловцом, подъём, ночь). Всё с `?dynres=0`, закреплёнными сидом, временем, погодой и зерном (`uSeed`).
- **`PostGoldenTests`** рендерят те же входы через Metal offscreen и сравнивают с допусками §5.1. Сцены сравниваются по SSIM, и каждая веха проходит ревью человеком в формате side‑by‑side.
- **Звук:**
  - `audio-traces` дают эталон «что и когда планируется» (топология и автоматизация), и он сравнивается точно;
  - `audio-goldens` дают эталон «как звучит» с допусками.
  - Перед финальным приёмом звука в M8 — слепое A/B‑прослушивание.

### 5.6 Подготовка веб‑кода (задачи W, выполняет владелец `rescue/`)

| № | Что | Зачем | Приёмка |
|---|---|---|---|
| W1 | Survivors: разделить `sys.rng` на `simRng` и `fxRng`. Убрать `Math.random` из ringSpin, фаз и lampPhase носителей, броска 6 % для бутылки (взять rng миссии), `p.spin`. Сбрасывать `Carrier.NEXT_ID` и `noteCursor` на `mission:setup`. В fx: якорь стаи чаек и шанс «ракеты в объектив» — от сидированного rng | паритет выживших и порядка подъёма | прогон op1 дважды с одним сидом даёт идентичные трассы; геймплей не изменился |
| W2 | `main.js`: `?fixeddt=<s>&manual=1` и `window.__game.advance(nFrames)` (rAF на паузе) | детерминированный прогон в Chromium | `replay_op1` воспроизводим |
| W3 | `input.mouse.lastMoveT` брать из `ctx.time.realT`, а не из `performance.now()` | нос вертолёта зависит от часов | трассы полёта не зависят от реального времени |
| W4 | Источник «сейчас» для дат (`todaySeed`, festive‑режим 27.12, рекорды «Смены») — через `ctx.clock` | закрепление даты в тестах | `?date=2026-10-16` работает |
| W5 | `core/events.js`: рекордер `?trace=1` → `window.__game.trace` (frame, t, name, payload) | replay‑векторы | формат совпадает с `EventTrace.swift` |
| W6 | Модули данных импортируются в Node без DOM (вынести `document.fonts`, `location.search` из модульного уровня) | экспорт в Node | `export-data` проходит без браузера |
| W7 | GLSL: `pow(x, 2.0)` → `x*x` (14 мест + `lookFront`) | неопределённое поведение при отрицательном основании | визуально без изменений на ANGLE |
| W8 | Океан: убрать фолбэк самостоятельной интеграции `uWindOffset` (единственный владелец — погода) | двойной дрейф | `look.uWindOffset` пишется одним местом |

W‑задачи — предусловие экспорта соответствующих векторов (W1 → survivors, W2/W5 → replay). Остальные векторы от них не зависят.

---

## 6. Ассеты: что процедурно, что запекается

| Ассет | Решение | Инструмент | Размер (оценка) |
|---|---|---|---|
| Шумовые текстуры atlas 256², detail 256², lace 512² (RGBA8) | **Запекаются байты** (`Resources/Textures/*.rgba`, SHA в манифесте). `LookGenerator` в Swift — опционально, проверка по SHA (±1 допустимо: libm и sort с 45 ничьими) | export-textures | 1,5 МБ |
| Текстура скал (terrainMaterial, 256², seed 913) | запекается `rock.rgba` | export-textures | 0,25 МБ |
| Сетка океана, рельеф и валуны, кольца, коллары, конусы, сетки воронок, квады, ленты кабеля и молний | **процедурно** в Swift (`MeshKit`, `TerrainMesh`, `OceanGrid`), сверка с `world/meshkit.json`, `ocean/grid.json` | — | — |
| Ручная геометрия (вертолёт: hull, hub, lights, rotor main/tail, shadow blades, floats, crew×3, basket, rescue swimmer, raft pack; мир: `lighthouse_{low,medium,high}`, `ship_arktur`, `rig_severnaya7`, `boat_patrol`, `boat_trawler`, `boat_cargo_<i>`, `floater_<shape>`, `container20`, `rigging_stick`, `debris_{board,barrel,lifebuoy,boat}`, `gull`, `dolphin`, `whale`, `veg_{spruce,shrub,tuft}`; выжившие: `person`, `craft_{raft,boat,yacht,container,plane,stretcher,lostbuoy,debris}`, `craft_{barge,ferry,trawler}_d<deckY>` для всех deckY кампании и «Смены» (сейчас 6, 7, 22), `bottle_{glass,inner}`) | **запекается** `.mmesh` (все атрибуты, включая `aSurf`/`aMat`/`aWear`/`aPart`/`aLimb`/`aChan`/`aCorner`/`aSize`, `drawRange`/`shadowRange`, `userData` в JSON‑блоке) | bake-meshes | v1 float32 и индексирование с точной дедупликацией: ~40–60 МБ; M9 квантование (snorm16 нормали, half‑цвет): < 25 МБ |
| Деколи и атласы canvas: `heli_livery.png` (1024×512), `deck_skalisty.png`, `deck_arktur.png` (+ форпик), `rig_roof.png`, `rig_roof_festive.png`, `veg_atlas.png` (512²), `craft_name_<slug>.png` для всех имён кампании и таблиц «Смены», `paper_grain.png` (feTurbulence, seed 7) | **запекаются PNG** из Chromium. Неизвестные в рантайме имена рисует CoreText‑фолбэк с Oswald (`DeckDecalPainter`) | bake-canvas | ~6 МБ |
| Env‑куб и IBL | **в рантайме на GPU** (§2.5) | — | — |
| Морские карты (брифинг, операции, дебрифинг, тактическая) | **процедурно**: `ChartModel` (Core) → `ChartPainter` (CoreGraphics). Фильтр фона — запечённая матрица | — | — |
| Иконки | SVG в asset catalog (Preserve Vector Data) | bake-icons | < 0,1 МБ |
| Шрифты | бандл OFL (Oswald variable, JetBrains Mono 400/600, Inter variable) и тексты лицензий | fetch-fonts.sh | ~1,6 МБ |
| Звук | **в рантайме** (синтез, §2.6). Бейков нет | — | — |
| Статика перехода, зерно, дизеринг | шейдеры | — | — |

**Формат `.mmesh` v1** (little‑endian, `tools/meshfmt/SPEC.md`, писатель `tools/meshfmt/write.mjs`, читатель `R/Core/MMeshLoader.swift`, верификатор `tools/meshfmt/verify.mjs`):

```
magic "MMSH" | u16 version=1 | u16 flags | u32 vertexCount | u32 indexCount (u32 индексы) |
u16 attrCount | attrs[attrCount] { char[16] name; u8 format(f32x1..4|snorm16x4|f16x4|u8x4n); u8 components; u16 reserved; u32 offset; u32 stride } |
u16 rangeCount | ranges { char[16] name ("main","shadow"); u32 start; u32 count } |
f32 bounds[8] (sphere xyzr, box min xyz… сокращённо) | u32 metaLen | meta JSON (userData) | выравнивание 16 | потоки атрибутов | индексы
```

---

## 7. Этапы

Оценки в инженеро‑неделях (и‑н) для сильного Swift+Metal инженера. Предлагаемая команда из 3 человек: **A** — Core и симуляция, **B** — рендер, **C** — UI, звук и платформа. Календарь ~6–7 месяцев; один инженер — ~13–14 месяцев.

| Веха | Объём | Критерии приёмки | Оценка |
|---|---|---|---|
| **M0. Экспорт и фундамент** | `tools/export` (shims, export-data, export-textures, export-vectors для math/look/palette/ocean, dump-glsl), все 25 JSON v1, `manifest.json`. `Package.swift`, `CJSMath` (fdlibm, V8 hypot и pow), `JSNumber`, `Rng`, `Noise`, `MathUtil`, `Vector/Quat/Mat4/Euler/Color`, `EventBus`, `GameTime`, `DataCatalog` и Codable‑схемы. `project.yml`, пустые iOS/macOS‑приложения с MTKView, заливка `#0b1a24`, шрифты. CI linux-core и export-drift | `swift test` зелёный на Linux и macOS. `jsmath` побитово на 100 тыс. векторов (pow — по §5.2). Повторный экспорт даёт нулевой diff. Приложения запускаются на iPhone 13 и M1 | A 3, B 1, C 1 |
| **M1. Ядро «море и небо»** | `Look` (fields, textures), `WaveBank`, `FeatureSet`, `CoastMap`, `OceanGrid`, `OceanSim` (+ uniforms), `WeatherSim`, `Palette`, `GustFronts`, `Lightning`, `EndlessPlanner`, `SunRig`, `EnvRebakePolicy`, `Settings`, `InputState` | все векторы `look/`, `weather/`, `ocean/`, `input/`, `settings/` проходят в своих классах допусков | A 4 |
| **M2. Рендер‑ядро и океан** | `RenderDevice`, `FrameRing`, `PipelineCache` (async), `RenderTargets`, `FrameGraph`, `CameraMatrices`, `DrawList` (сортировка three), `ShaderTypes.h`, `GL.h`, `ThreePBR.h`, `Shadow.h`, `Fog.h`, `IBL` (EnvSky + Prefilter), `LightRig`/`ShadowPass`. Океан: вершинный шейдер, селф‑тест, затем 17 слоёв по порядку DESIGN, память воды. Bloom, CompositeOutput, FinalPass (грейдинг, зерно, виньетка, CA, вспышка, edge‑пульсы), `PostState`, `DynRes` | селф‑тест океана p99 < 5 см на iPhone 13 и M1. `PostGoldenTests` в допусках. 8 пресетов: SSIM ≥ 0,92 и ревью. Сцена «только океан + небо», medium на iPhone 13: GPU ≤ 9 мс | B 7 |
| **M3. Вертолёт и камера** | `FlightModel`, `HeliOps`, `Winch`/`CableVerlet`, `Helicopter`, `HeliLights`, `Searchlight`, `CrewmanIK`, `CameraRig`, `CameraMotion`, `Projection`. Бейк мешей вертолёта. Шейдеры Hull (+weathering, clearcoat), Rotor, Lights, Cone, Cable, Ring. Ввод: клавиатура и мышь (Mac), геймпад, тач. Хаптика | векторы `heli/`, `camera/` (600 шагов побитово). Полёт и лебёдка на всех трёх схемах ввода. Ревью поведения с вебом side‑by‑side | A 3, B 2, C 1 |
| **M4. ПЕРВЫЙ ИГРАБЕЛЬНЫЙ: операция 1 «Первый вылет»** | Мир op1: остров «Скалистый» (`Terrain`/`Landforms`, Terrain.metal, валуны, растительность), маяк (бейк, луч, лампы, ветроуказатель, ревун), скалы, буи east/west (ритмы), плавучие обломки (kayak, paddle), коллары. Выжившие: пловцы (crowd: Person, ghost, keyline), плот ПСН‑6 (Craft), детекция, тепло, дрейф, датумы, `SignalDesk` (ракеты, дым, свисток, зеркало, EPIRB). FX: частицы (брызги, дым, glow), ракеты и фальшфейеры, lightpool, чайки‑подсказка, дождь (лёгкий). Погода calm → overcast (скрипт 240 с), безвредный порыв. `MissionDirector` (скрипт op1: `rocket`, `gust`, `after: boarded`), Ledger, Scorer, Report, Onboarding (takeoff, move, descend, winch, land), чекпоинт посадки. Радио: очередь, триггеры, субтитры. HUD (HudKit): кольцо вертолёта, датумы, маркеры людей и сигналов, площадки, краевые индикаторы, лента компаса, высотомер, прицел и окно лебёдки, панели (нижняя полоса, РВ, метео, задача), предупреждения, тосты, подсказки, радар. Экраны: предупреждение о вспышках, Title (простой), Briefing (текст без карты), Pause, Debrief (строки, очки, медали). Звук: ротор, турбина, ветер и море, лебёдка, алармы, голос радио, базовые SFX, музыка (слои 1–3), микшер | op1 проходится от титула до дебрифинга на iPhone 13 (тач), Mac (клавиатура + мышь) и с геймпадом. `mission/replay_op1` проходит (события и отчёт точно). 60 fps medium на iPhone 13, 1 %‑low ≥ 55, 10 мин без `thermalState > .fair`. Ревью side‑by‑side с вебом подписано | A 4, B 4, C 5 |
| **M5. Кампания 1–4: «Паром», «Молоко», «Буровая»** | Судно «Арктур» (навигация, посадка на качающуюся палубу, сигнальщик, green water, гудок), буровая (факел, шлейф, подветренная турбулентность), носители wreck/deck/hull/container/barge/ferry/trawler, тонущие корпуса, питомцы, бутылка. Туман: слои, глори. Rogue (опасность, океанская фича, RogueFx), чекпоинты опасностей (Codable). `Floaters` полностью | операции 1–4 проходятся. Векторы `world/`, `survivors/`, `hazards/rogue` проходят. Перф как в M4 на «Буровой» в шторм | A 3, B 2, C 1 |
| **M6. Опасности, FX и тепловизор полностью** | Водяные смерчи и торнадо (VortexFx, curtains, debris), водоворот, нисходящий поток, град, заряды и молнии (визуал, огибающие reduceFlashes), scud и тени облаков, полосы порывов, жизнь (дельфины, кит, медузы). `HeatPass` + FLIR в FinalPass. Капли на линзе, конденсат, соль. Фоторежим (DOF, грейды, захват, сохранение, жесты на тач). Операции 5–9★ | вся кампания проходится. Пулы слотов совпадают с вебом (векторы). Перф: шторм + смерч + дождь на iPhone 13 medium ≤ 14 мс GPU | A 3, B 5 |
| **M7. «Смена», HUD и меню полностью** | `ShiftGenerator` и рекорды, тактическая карта, карты брифинга, операций и трека дебрифинга (ChartPainter), операции и медали, настройки и управление (переназначение), пауза (лог радио), записка, переходы, glitch/EMP, колорблайнд, масштабы hs/ts, раскладки compact | векторы `hud/`, `text/`, `mission/shift` проходят. Раскладка ≤ 1 px к дампам на 1920×1080 и 844×390. Снапшоты экранов одобрены | A 1, C 5 |
| **M8. Звук полностью** (параллельно с M2–M7; ядро DSP начинается в M2) | `CMaydayDSP` (все ноды, таймлайн, свёртка), `MaydaySynth` (все модули), `AudioHost` (сессия, прерывания, маршруты) | трассы автоматизации точно. Буферы по SHA. Офлайн‑рендеры в допусках. CPU ≤ 12 % ядра A15. Слепое A/B | C 6 |
| **M9. Оптимизация, тепло, полировка, релиз** | half‑точность в цвете поста и океана (по «золотым» кадрам), квантование `.mmesh`, MTLBinaryArchive при необходимости, `ThermalGovernor`, 120 Гц‑режим, Low Power. App Store: иконки, скриншоты, тексты RU и EN, приватность, возрастной рейтинг, TestFlight. Опционально: iCloud‑прогресс, Game Center. Подготовка EN (`TextLocale`) | холодный старт ≤ 3 с до титула. 30‑минутная сессия без троттлинга ниже 50 fps. Краш‑фри ≥ 99,5 % в TestFlight. Ревью App Store пройдено | A 1, B 3, C 2 |

Сумма ≈ 79 и‑н (A 22, B 24, C 21, плюс ≈ 12 и‑н на интеграцию и ревью, распределённые по вехам).

**Критический путь:** M0 (`CJSMath`, данные) → M1 (`WaveBank`) → M2 (`ThreePBR` и океан) → M4.
- Звук (M8) и экраны (M7) идут параллельно с M2–M6.
- Первый компилируемый Swift‑код должен оказаться на Mac в первую неделю M0: в этом контейнере нет тулчейна, ошибки компиляции нужно ловить рано.

---

## 8. Риски и решения

| Риск | Вероятность / влияние | Решение и смягчение |
|---|---|---|
| Фрагментная стоимость океана на TBDR (до ~70 выборок на пиксель, циклы 8/24/8) | высокая / высокое | Function‑constant варианты по качеству. Внутреннее разрешение ≤ 2,07 Мп (веб‑правило). Early‑z (океан после пропсов). Dynres по GPU‑времени. Профиль в Metal System Trace с M2. `half` в цвете в M9. Запасной вариант — уровень medium‑lite без `OCEAN_Q` 1 |
| Пропускная способность памяти (≈ 6 полноэкранных проходов fp16) | средняя / среднее | MSAA и depth memoryless, `.multisampleResolve`, склейка composite+output, `dontCare`‑load, bloom от ½ / ¼. Без чтения из drawable |
| Тепловой троттлинг iPhone | высокая / высокое | 60 fps по умолчанию. `ThermalGovernor`: `.serious` → минимум масштаба и bloom на ½, `.critical` → 30 fps и low. Low Power Mode → 30 fps (опция). Тест 30 мин на устройстве в CI |
| Память (iPhone 13, 4 ГБ) | низкая / среднее | Бюджет: GPU ≤ 250 МБ (меши ~60 МБ v1, RT ~60 МБ, тени 16 МБ, текстуры < 20 МБ), процесс ≤ 600 МБ. Меши выгружаются между миссиями. Обработка `didReceiveMemoryWarning` |
| Вспышки при компиляции PSO | средняя / высокое | Полная прекомпиляция по реестру (§3.5), покрытие сверяется с `programs.json`. Без ленивых PSO в игре: ассерт в debug |
| Отсутствие Swift и Xcode в этом контейнере (код пишется «вслепую») | высокая / среднее | Ранний Mac‑CI (M0). Мелкие PR. Linux‑CI для Core и Synth. `ShaderTypesLayoutTests`. Компиляция `.metal` в CI на каждый PR |
| Неполный паритет libm (`pow`) | средняя / низкое | Порт V8‑алгоритма в M0, до этого допуск 1 ulp. Правило «без Foundation‑математики в Core» проверяется линтером |
| Хаос длинных траекторий (кабель, полёт, погода) | высокая / низкое | Короткие горизонты побитово, дальше классы допусков и сравнение событий. Replay по входам, а не по состояниям |
| Семантика освещения и тонмаппинга three | средняя / высокое | Порт `ThreePBR.h` по собранному GLSL (`Reference/glsl`). Синтетические «золотые» кадры каждого прохода. Защита оранжевого настроена под ACES Hill — ACES только этот |
| Перевёрнутые оси и UV (DOF, «холоднее к верху» FLIR, засечки, адвекция памяти воды, потоки капель) | высокая / среднее | `GL.h` с `rtUV` и `fragCoordGL`, флип clip‑y для data‑проходов. Отдельный golden‑кейс на каждый из этих эффектов |
| Тач‑UX (большие пальцы закрывают HUD, удержание лебёдки, слайдер высоты, фоторежим без тач‑управления в вебе) | средняя / высокое | Порт `touch.js` 1:1 и плейтест в M4 на iPhone mini и Pro Max. Safe‑area поверх `SAFE = 24`. Новые жесты фоторежима (pinch — зум, 2 пальца — пан, 1 палец — орбита) с дизайн‑ревью. Отклонения вносятся в реестр |
| Правила App Store | низкая / среднее | Нет загружаемого кода и JIT. Photos add‑only. `PrivacyInfo.xcprivacy`. `ITSAppUsesNonExemptEncryption = NO`. Предупреждение о вспышках в игре и в описании. Возрастной рейтинг по анкете (опасность и утопление, без насилия). Проверить занятость имени «MAYDAY», фолбэк — «MAYDAY: морские спасатели» |
| Лицензии | низкая / среднее | Шрифты OFL 1.1 (бандл немодифицированных файлов и `OFL.txt`). three.js MIT (портированные формулы шейдеров), fdlibm (уведомление Sun), V8 и Chromium BSD‑3 (hypot, pow, ядро компрессора, конволвер, PeriodicWave), pffft/KissFFT BSD. Экран «Лицензии» в настройках. Никакого LGPL‑кода (glibc‑sin не берём, §5.2) |
| Локализация RU / EN | средняя / среднее | v1 только RU (`CFBundleDevelopmentRegion = ru`). Тексты и грамматика в Core (`TextLocale`, реализация `ru`). EN — после релиза: в вебе таблицы и грамматика EN, затем экспорт. Метаданные App Store RU и EN с самого начала |
| Доступность | средняя / среднее | reduceFlashes из Reduce Motion и Dim Flashing Lights. reduceMotion. Субтитры по умолчанию. Колорблайнд‑маркеры. textScale по Dynamic Type (1,0…1,5). VoiceOver: SwiftUI‑экраны нативно, полётные предупреждения и субтитры через `UIAccessibility.post(.announcement)`. Системное переназначение кнопок контроллера плюс игровое для клавиатуры. Лимит фотосенситивности (≤ 3 вспышки/с, reduced‑режим) покрыт векторами огибающих |
| Real‑time безопасность звука | средняя / высокое | Ядро на C без аллокаций, SPSC‑очереди, пулы. Тест «заглушенного аллокатора» в офлайн‑режиме. Thread Sanitizer в CI |
| Связность систем (утиная типизация JS, восстановление чекпоинта через `Object.assign`) | высокая / среднее | Протоколы систем и Codable‑снапшоты на систему, определённые в M0/M1 до порта миссии. Стабильные ID вместо ссылок |
| Порядок событий и re‑entrancy | средняя / среднее | Шина с семантикой веба. Подписки в том же месте жизненного цикла. `replay_op1` ловит отклонения |
| Точность времени `float32` на GPU в длинных сессиях | низкая / низкое | Семантика веба (`uTime = Float(t)`). В M9 — ребейз времени на `mission:setup`, если артефакты заметны в «Смене» |

---

## 9. Структура каталогов `rescue-apple/`

```
rescue-apple/
├── PLAN.md                         ← этот документ
├── README.md                       сборка, экспорт, тесты (M0)
├── Core/                           SwiftPM‑пакет (дочерний каталог: Xcode не принимает локальный пакет‑предок проекта)
│   ├── Package.swift               CJSMath, MaydayCore, CMaydayDSP, MaydaySynth, mayday-vectors, тесты (Linux+Apple)
│   ├── Sources/
│   │   ├── CJSMath/                include/jsmath.h, fdlibm.c, v8math.c (hypot, pow) — #pragma STDC FP_CONTRACT OFF
│   │   ├── MaydayCore/             Math/ Core/ Data/(Schemas/) Input/ Look/ Mesh/ Ocean/ Weather/ World/(Terrain/ Places/)
│   │   │                                  Hazards/ FX/ Heli/ Camera/ Survivors/ Mission/ Radio/ Post/ HUD/(Flight/ Chart/ Screens/) Text/
│   │   ├── CMaydayDSP/             include/mdsp.h, graph.c, param.c, nodes_*.c, convolver.c, compressor.c, fft.c, spsc.c
│   │   ├── MaydaySynth/            Graph/ Sounds/ DSPResources.swift AudioDirector.swift Offline.swift
│   │   └── mayday-vectors/         CLI: прогон векторов и печать расхождений (для отладки на Linux/Mac)
│   └── Tests/
│       ├── MaydayCoreTests/        Support/(VectorLoader Asserts SHA256) + тесты по доменам
│       └── MaydaySynthTests/
├── project.yml                     XcodeGen: Mayday-iOS, Mayday-macOS, MaydayRender/Audio/UI/App, тестовые цели
├── Configs/                        Base.xcconfig, Debug.xcconfig, Release.xcconfig (MTL_FAST_MATH=NO, Metal31, SWIFT_VERSION)
├── .swiftlint.yml                  custom_rules: no_libm_in_core, no_math_random, no_force_unwrap_in_core
├── Sources/
│   ├── MaydayRender/               [Xcode] Core/ Look/ Lighting/ Ocean/ Weather/ World/ Hazards/ FX/ Heli/ Survivors/ Post/ Hud/ Scene/ Textures/ Pipelines/
│   │   └── Shaders/                ShaderTypes.h, module.modulemap, Common/(GL.h Common.h ThreeVertex.h ThreePBR.h Shadow.h IBL.h Fog.h
│   │                               Look.h Noise.h ACES.h Weathering.h Keyline.metal Standard.metal Basic.metal Line.metal) Ocean/ Lighting/
│   │                               World/ Water/ Hazards/ FX/ Heli/ Survivors/ Post/ UI/
│   ├── MaydayAudio/                [Xcode] AudioHost.swift, SessionManager.swift
│   ├── MaydayUI/                   [Xcode] Screens/ Chart/ Theme/ HudCoordinator.swift
│   ├── MaydayApp/                  [Xcode] GameHost.swift, MetalView.swift, RootView.swift, Input/ Persistence/ Platform/
│   ├── AppIOS/                     [Xcode] MaydayIOSApp.swift, Info.plist, LaunchScreen.storyboard, PrivacyInfo.xcprivacy, Assets.xcassets
│   └── AppMac/                     [Xcode] MaydayMacApp.swift, Info.plist, Mayday.entitlements, PrivacyInfo.xcprivacy, Assets.xcassets
├── Tests/
│   ├── MaydayRenderTests/          [Xcode] OceanSelftestTests, PostGoldenTests, ShaderTypesLayoutTests, PipelineCoverageTests
│   ├── MaydayUITests/              [Xcode] снапшоты экранов
│   ├── Vectors/                    экспорт (§5.3): math/ look/ weather/ ocean/ world/ hazards/ fx/ heli/ camera/ survivors/ mission/ radio/ text/ input/ settings/ post/ hud/ audio/
│   └── Goldens/                    final/ post/ scenes/ audio/
├── Resources/
│   ├── Data/                       25 JSON (§4.2) + manifest.json
│   ├── Textures/                   atlas.rgba detail.rgba lace.rgba rock.rgba, Decals/*.png
│   ├── Meshes/                     *.mmesh
│   ├── Fonts/                      Oswald[wght].ttf, JetBrainsMono-Regular.ttf, JetBrainsMono-SemiBold.ttf, Inter[opsz,wght].ttf, OFL-*.txt
│   ├── Icons/                      *.svg
│   └── Licenses/                   three-MIT.txt, fdlibm.txt, v8-BSD.txt, chromium-BSD.txt, pffft.txt
├── Reference/                      glsl/*.vert|frag, programs.json (не в бандле; спецификация для MSL)
└── tools/
    ├── export/                     run-all.mjs, shims/, export-data.mjs, export-textures.mjs, export-vectors.mjs, audio-traces.mjs,
    │                               export-browser.mjs, bake-meshes.mjs, bake-canvas.mjs, dump-glsl.mjs, render-goldens.mjs,
    │                               audio-goldens.mjs, bake-icons.mjs, fetch-fonts.sh, verify.mjs
    ├── meshfmt/                    SPEC.md, write.mjs, verify.mjs
    └── ci/                         linux-core.sh (docker swift:6.0-jammy), export-drift.sh, apple.sh
```

`Core/Package.swift` (создаётся в M0 в таком виде; пути целей — относительно `Core/`):

```swift
// swift-tools-version:5.10
import PackageDescription

let package = Package(
  name: "Mayday",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "MaydayCore", targets: ["MaydayCore"]),
    .library(name: "MaydaySynth", targets: ["MaydaySynth"]),
    .executable(name: "mayday-vectors", targets: ["mayday-vectors"]),
  ],
  targets: [
    .target(name: "CJSMath", path: "Sources/CJSMath"),
    .target(name: "MaydayCore", dependencies: ["CJSMath"], path: "Sources/MaydayCore"),
    .target(name: "CMaydayDSP", path: "Sources/CMaydayDSP"),
    .target(name: "MaydaySynth", dependencies: ["CMaydayDSP", "MaydayCore"], path: "Sources/MaydaySynth"),
    .executableTarget(name: "mayday-vectors", dependencies: ["MaydayCore"], path: "Sources/mayday-vectors"),
    .testTarget(name: "MaydayCoreTests", dependencies: ["MaydayCore"], path: "Tests/MaydayCoreTests"),
    .testTarget(name: "MaydaySynthTests", dependencies: ["MaydaySynth"], path: "Tests/MaydaySynthTests"),
  ]
)
```

- Каталоги `Sources/MaydayRender|MaydayAudio|MaydayUI|MaydayApp|AppIOS|AppMac` лежат вне пакета, и SwiftPM их не собирает. Их собирает только XcodeGen.
- `project.yml` подключает пакет как локальный (`packages: Mayday: {path: Core}`) и задаёт мультиплатформенные цели через `supportedDestinations: [iOS, macOS]`. Метал‑библиотека собирается из `Sources/MaydayRender/Shaders/**/*.metal`, ресурсы `Resources/**` копируются в приложения.
- Пакет вынесен в дочерний каталог `Core/`, потому что `Mayday.xcodeproj` генерируется в `rescue-apple/`, а Xcode отвергает локальный пакет, который является предком проекта. Первый шаг на Mac после `xcodegen generate` — `xcodebuild -resolvePackageDependencies -project Mayday.xcodeproj`.

---

## 10. Реестр отклонений от веба

| № | Отклонение | Причина | Проверка |
|---|---|---|---|
| X1 | MSAA фиксирован на уровень качества, без 4→2 на лету | sampleCount входит в PSO | Dynres меняет только масштаб; golden‑кадры при scale 1 |
| X2 | Dynres считается по GPU‑времени | rAF‑время на 60/120 Гц бессмысленно | `post/state.json` без dynres (`?dynres=0`) |
| X3 | Всегда HDR + OutputPass, в том числе на low | одна схема и дешёвый TBDR | идентичная математика ACES и sRGB |
| X4 | Composite и Output — один проход | пропускная способность | разница ≤ округление fp16 (golden) |
| X5 | Качество по умолчанию на iPhone — medium (в вебе для тача low) | натив быстрее | `settings` тест с инжектированным устройством |
| X6 | Нет экрана «нажмите любую клавишу» | звуку не нужен жест | ScreenStack‑вектор с флагом платформы |
| X7 | Только landscape вместо гейта портрета | iOS‑конвенция | — |
| X8 | Сохранение фото в Фото или `~/Pictures` вместо загрузки PNG | платформа | ручной тест |
| X9 | Новые тач‑жесты фоторежима и хаптика на iPhone | в вебе их нет | дизайн‑ревью |
| X10 | Текст «на этом устройстве» вместо «в этом браузере» | правда | — |
| X11 | 60 fps по умолчанию, 120 Гц — опция | тепло и батарея, паритет поведения 60 Гц | Perf‑план |
| X12 | `lookFront` и 14 мест `pow(x,2)` → `x*x` | UB в GLSL/MSL | W7 делает веб таким же |
| X13 | Эталон CPU — Node (fdlibm), не Chromium (glibc) | лицензия и воспроизводимость | §5.2 |
| X14 | `Heli/Hull.metal`: сажа выхлопа `exp(-pow(d, 2.0))` с возможно отрицательным `d` → `exp(-sq(d))` (как X12) | UB в GLSL/MSL | W7 делает веб таким же |
| X15 | Деколи ливреи вертолёта (`uDecal`, heli/decals.js) — прозрачная заглушка, пока `bake-canvas` не даст `heli_livery.png` (при загрузке перевернуть строки, как `flipY`) | атлас рисуется canvas с Oswald в Chromium | `HeliRenderer(decal:)`; сверка «золотым» кадром после бейка |
| X16 | Свободный полёт M3 (`MaydayApp/Session/FreeFlight.swift`): stubs.js Mission («Свободный полёт», площадка stubs.js World) плюс правила mission.js — ввод только в полёте, Esc/Start → пауза с rAF‑опросом, `ui:pause`, после `heli:crash` через `CRASH_TO_DEBRIEF_S` новый старт вместо дебрифинга | MissionDirector, World и экраны появятся в M4 | `Tests/Vectors/app/session_flight.json` (export-app.mjs; харнесс applecheck, побитово 78 полей × 2700 кадров, события, вибрация) |
| X17 | Тач‑раскладка `.hud-touch`: к отступам прибавляются safe‑area insets; хит‑зоны меток фиксаторов 26 × 23 pt (в вебе — размер текста); контролы, скрытые посреди жеста, отпускают оси и кнопки | вырез и скругления iPhone; UIKit не измеряет DOM | `app/touch.json` (стик и слайдер touch.js); плейтест |
| X18 | Вибрация: dual‑rumble → CoreHaptics (strong — левая рукоять, weak — правая, иначе оба события на default; новый эффект останавливает прежний). На iPhone правила `HapticRules` с силой ≥ 0,3 — `UIImpactFeedbackGenerator` (heavy от 300 мс) и лёгкий тап на тач‑кнопках, только при `lastDevice == touch` (уточнение X9) | у Apple нет `playEffect('dual-rumble')`; слабые правила телефон не передаёт | правила — `input/haptics.json`; запросы — `app/session_flight.json`; ощущение — ручной тест |
| X19 | Отладка вне биндингов веба: `[ ]` — пресет погоды (6 с), F2 — качество, F5 — заново; геймпад: держать View + LB/RB, Y, R3, Menu (кнопки аккорда скрыты от игры); кнопки в оверлее на таче | в вебе это URL‑параметры и консоль | — |
| X20 | До `HeliRenderer` вертолёт рисуется заглушкой stubs.js (BoxGeometry 3 × 2 × 10, #FF5A2A) на матрице корпуса настоящего `Helicopter`, с тенью | бейк мешей вертолёта (M3, render‑heli) | `SceneProps.placements` (харнесс) |

---

## Приложение A. Первые файлы, которые создают сборщики

**Core (неделя 1–2 M0, порядок важен):**

Пути пунктов 1–9 — внутри `Core/`.

1. `Package.swift`
2. `Sources/CJSMath/include/jsmath.h`, `Sources/CJSMath/fdlibm.c`, `Sources/CJSMath/v8math.c`
3. `Sources/MaydayCore/Math/JSMath.swift`, `JSNumber.swift`, `Rng.swift`, `Noise.swift`, `MathUtil.swift`, `Vector.swift`, `Quaternion.swift`, `Matrix4.swift`, `Euler.swift`, `Color.swift`
4. `Sources/MaydayCore/Core/EventBus.swift`, `Events.swift`, `EventTrace.swift`, `GameTime.swift`, `Game.swift`, `SystemProtocols.swift`, `StubSystems.swift`, `Settings.swift`
5. `Sources/MaydayCore/Data/DataCatalog.swift`, `JSNumberBox.swift`, `Schemas/{GameData,LookData,OceanData,WeatherData,PaletteData,InputData,SettingsData}.swift`
6. `Sources/MaydayCore/Look/LookTextures.swift`, `LookFields.swift`
7. `Sources/MaydayCore/Weather/Palette.swift`
8. `Sources/MaydayCore/Ocean/WaveBank.swift`, `FeatureSet.swift`, `CoastMap.swift`, `OceanGrid.swift`
9. `Tests/MaydayCoreTests/Support/{VectorLoader,Asserts,SHA256}.swift`, `JSMathTests.swift`, `JSNumberTests.swift`, `RngTests.swift`, `NoiseTests.swift`, `LookTests.swift`, `PaletteTests.swift`, `WaveBankTests.swift`, `FeatureSetTests.swift`, `CoastTests.swift`, `DataCatalogTests.swift`

**Render (неделя 1–3 M0/M2):**

1. `project.yml`, `Configs/{Base,Debug,Release}.xcconfig`
2. `Sources/MaydayRender/Shaders/ShaderTypes.h`, `module.modulemap`, `Shaders/Common/{GL.h,Common.h,Look.h,Noise.h,Fog.h,ACES.h,ThreeVertex.h,ThreePBR.h,Shadow.h,IBL.h}`
3. `Sources/MaydayRender/Core/{RenderDevice,FrameRing,PipelineCache,RenderTargets,FrameGraph,CameraMatrices,DrawList,MeshBuffer,MMeshLoader}.swift`
4. `Sources/MaydayRender/Look/LookResources.swift`
5. `Sources/MaydayRender/Ocean/{OceanRenderer,OceanPipeline,OceanSelftest}.swift`, `Shaders/Ocean/{OceanCommon.h,OceanFeatures.h,Ocean.metal,OceanSelftest.metal}`
6. `Sources/MaydayRender/Post/{PostChain,CompositeOutputPass}.swift`, `Shaders/Post/{Fullscreen.metal,Output.metal}`
7. `Sources/MaydayRender/Renderer.swift`
8. `Sources/MaydayApp/{GameHost,MetalView,RootView}.swift`, `Sources/AppIOS/MaydayIOSApp.swift`, `Sources/AppMac/MaydayMacApp.swift`
9. `Tests/MaydayRenderTests/{ShaderTypesLayoutTests,OceanSelftestTests}.swift`

**Экспортёр (неделя 1 M0):** `tools/export/run-all.mjs`, `shims/loader.mjs`, `shims/dom.mjs`, `export-data.mjs`, `export-textures.mjs`, `export-vectors.mjs` (группы `math`, `look`, `weather/palette`, `ocean`), `dump-glsl.mjs`, `verify.mjs`.
