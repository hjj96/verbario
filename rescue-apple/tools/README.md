# Экспорт веб → порт (MAYDAY)

Источник истины для нативного порта — веб-версия `rescue/`. Скрипты в `tools/export/` загружают
**настоящие ES-модули игры** и выгружают из них:

- данные в `Resources/Data/*.json`;
- текстуры look-атласа в `Resources/Textures/*.rgba`;
- DFG LUT three.js в `Resources/Textures/dfg_lut.rg16f` (`export-render.mjs`, из вендорного бандла three);
- векторы паритета в `Tests/Vectors/**`.

Swift-тесты (`MaydayCoreTests`) сверяются с этими векторами. SwiftPM-пакет лежит в `rescue-apple/Core`
(`swift test --package-path rescue-apple/Core`), а не в корне `rescue-apple`: Xcode не принимает локальный
пакет, который является предком проекта. Данные и векторы остаются в `rescue-apple/Resources` и
`rescue-apple/Tests/Vectors`; тесты находят их, поднимаясь от `#filePath` до каталога с `Resources/Data/manifest.json`.

В `rescue/` ничего не меняется: модули только читаются.

## Требования

| Что | Зачем | Где берётся |
|---|---|---|
| Node 22 | Эталонный движок: вся CPU-математика векторов считается в Node, см. PLAN §5.2 | `node -v` → v22.x |
| acorn | Разбор верхнего уровня модулей и поиск событий и сидов | `require('acorn')`, иначе `/opt/node-tools/node_modules/acorn`. В CI: `npm i -g acorn` |
| Playwright + Chromium | Нужны только для `--browser`: карты берега и сверка с живой игрой | `PLAYWRIGHT_MODULE`, иначе `playwright`, иначе `/opt/node22/lib/node_modules/playwright/index.mjs` |

Статический сервер не нужен: `export-browser.mjs` и `verify.mjs` сами раздают корень репозитория на свободном порту.

Запуски Chromium сериализуются lock-каталогом, потому что SwiftShader грузит CPU:

- путь по умолчанию — `$TMPDIR/mayday-chromium.lock`;
- чтобы делить lock с `scratchpad/tools/shot.mjs`, задайте `MAYDAY_CHROMIUM_LOCK=<scratchpad>/tools/.chromium.lock`;
- ожидание ограничено `MAYDAY_CHROMIUM_LOCK_WAIT_MS` (по умолчанию 12 мин); по истечении экспортёр падает с
  `chromium lock busy`, а не запускает Chromium параллельно с владельцем;
- чужой lock снимается, только если владелец точно мёртв: его PID не существует или его heartbeat
  (владелец обновляет `hb` и `t` каждые 15 с) старше 2 мин. Возраст самого lock роли не играет.

## Команды

Все команды запускаются из корня репозитория (`verbario/`).

```sh
# всё, что считается в Node: DFG LUT + данные + векторы + проверка (≈ 5 с)
node rescue-apple/tools/export/run-all.mjs

# плюс Chromium: карты берега (ocean/coast_*) и сверка с живой игрой (≈ 1 мин)
node rescue-apple/tools/export/run-all.mjs --browser

# по шагам (render идёт до data: manifest.json хеширует свежий dfg_lut.rg16f)
node rescue-apple/tools/export/export-render.mjs      # Resources/Textures/dfg_lut.rg16f (+ переписывает manifest.json)
node rescue-apple/tools/export/export-data.mjs        # Resources/Data/*.json, manifest.json, Resources/Textures/*.rgba
node rescue-apple/tools/export/export-vectors.mjs     # Tests/Vectors/** (Node)
node rescue-apple/tools/export/export-vectors.mjs --only ocean,heli   # группы: math,look,palette,ocean,heli,mission,text
node rescue-apple/tools/export/export-browser.mjs     # Tests/Vectors/ocean/coast_<id>.json + .u8 (по умолчанию --missions 0,2)
node rescue-apple/tools/export/verify.mjs             # разбор, обёртки, размеры, полнота и хеши manifest, сайдкары
node rescue-apple/tools/export/verify.mjs --browser   # + сверка с живой игрой в Chromium, 0 ошибок консоли
```

Результат детерминирован: повторный запуск даёт побайтно те же файлы. Временных меток в файлах нет.

## Когда перезапускать

- **После любого изменения в `rescue/src`**, которое трогает:
  - таблицы: пресеты, кампанию, реплики, константы;
  - логику, покрытую векторами: `core/math.js`, `core/look.js`, `ocean/waves.js`, `ocean/coast.js`, `heli/flight.js`, `mission/scoring.js`, `mission/prepare.js`, `radio/words.js`, `mission/text.js`, `weather/palette.js`.

  Реэкспорт коммитится в том же PR, что и правка веба. Поле `source` во всех файлах равно `git rev-parse HEAD` веба. Если `rescue/` был грязным, ставится `sourceDirty: true`; такой экспорт не коммитить.
- **Когда добавлен новый модуль в `rescue/src`.** `export-data` упадёт с сообщением «modules not assigned to any data file». Модуль нужно добавить в таблицу `FILES` (или в `NO_DATA`) в `export-data.mjs`.
- **Когда меняется рельеф или качество low.** Перезапустите `export-browser.mjs`.
- **В CI** (`export-drift`) вызывается `run-all.mjs --browser`, затем `git diff --exit-code rescue-apple/Resources rescue-apple/Tests/Vectors`.

## Как это устроено

- **`shims/loader.mjs`** подключается первым в каждом экспортёре. Он ставит стабы браузера (`shims/dom.mjs`) и регистрирует ESM-хуки (`shims/hooks.mjs`). Хуки делают две вещи:
  - `three` и `three/addons/*` разрешаются в `rescue/vendor/three`, то есть ровно в то, что даёт importmap страницы;
  - к каждому модулю `rescue/src/**` дописывается `export function __scope()`. Он отдаёт **все** привязки верхнего уровня, экспортированные и нет (геттеры, TDZ-безопасно). Поэтому приватные таблицы (`K`, `LINES`, `PRESETS`…) выгружаются без правок веба.
- **`Math.random`** в Node заменён на mulberry32 с сидом `MAYDAY_RANDOM_SEED` (по умолчанию 20261016).
- **Дата для `prepareDef`** заморожена на 2026‑10‑16. Это затрагивает endless и title.
- **`lib/common.mjs`** отвечает за сериализацию живых значений, детерминированный pretty‑JSON, обёртку, сайдкары и sha256. Сериализатор самодостаточен (`makeSerializer`), и `verify --browser` выполняет тот же код внутри страницы.

## Формат файлов

```json
{
  "schema": "mayday.<file>",
  "version": 1,
  "source": "<git HEAD веба>",
  "sourceDirty": false,
  "sourceFiles": ["rescue/src/…"],
  "producer": "tools/export/<script>",
  "omitted": {"<module>": {"glsl": [], "mutable": [], "scratch": []}},
  "tolerance": {"class": "bitwise|chaos|bytes", "note": "…"},
  "data": {}
}
```

Поле `omitted` есть только у данных, `tolerance` — только у векторов.

### Данные (`Resources/Data/<file>.json`)

`data["<модуль>"]["<ИМЯ>"]` содержит сериализованное живое значение. Модуль записывается путём под `src/` без `systems/` и `.js`, например `weather/presets` или `ui/flight/overlay`. Вычисленные таблицы лежат в `data.derived`:

- `game.json`: порядок систем, правило dt, сиды, камера, все места сидирования RNG;
- `settings.json`: уровни качества и автостабилизация;
- `look.json`: дефолты uniform и описания текстур;
- `mission.json`: правила медалей и цепочек стиля.

Таблица `FILES` в `export-data.mjs` закрепляет за каждым модулем ровно один файл. Покрытие проверяется: все 158 модулей учтены.

Что сериализатор делает со значениями:

| Значение | Как выглядит в JSON |
|---|---|
| `THREE.Color` | `{"hex", "lin"}`; `lin` — точные linear‑значения three, они авторитетны. `hex` зажат в 0…1 |
| `Vector2/3/4`, `Quaternion` | массив |
| `Euler` | `[x, y, z, order]` |
| `Set` | массив |
| `RegExp` | `{regexp, flags}` |
| Функция | `{fn, src}`; функция не исполняется, `src` — текст правила длиной ≤ 400 символов |
| GLSL-строка | не попадает в данные, её имя перечислено в `omitted.glsl`. Привязка верхнего уровня считается GLSL по тегу `/* glsl */` перед шаблонной строкой (`lib/ast.mjs` `glslTaggedBindings`), вложенные строки — по текстовой эвристике `GLSL_HINT`. Шейдеры выгружает будущий `dump-glsl` |
| Привязки `let` (состояние) и `_scratch` | перечислены в `omitted` |

`events.json` строится статическим разбором всех вызовов `emit/on`. В нём есть эмиттеры, слушатели, ключи payload и отметка `inContract`, если событие упомянуто в CONTRACT.md.

`manifest.json` хранит размер и sha256 всех файлов данных и текстур, включая `dfg_lut.rg16f` (schema `raw.rg16f`, 1024 байта). Его пишет `writeManifest` из `lib/common.mjs` (вызывают `export-data` и `export-render`); `verify.mjs` падает, если какой-то файл `Resources/Data/*.json` или `Resources/Textures/*` в нём не указан.

`Resources/Textures/{atlas,detail,lace}.rgba` — сырые RGBA8, `Look(7)`, строка 0 соответствует v = 0. SHA совпадают с PLAN: `dbc12a36…`, `c8ede53a…`, `a4ce9ae9…`.

### Конвенции

- **Числа** записываются кратчайшей обратимой записью JS (для double это точно). Спецзначения пишутся строками: `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"`.
- **Пробелы.** NBSP и прочие невидимые пробелы экранируются (` `, ` `).
- **Порядок ключей** — порядок вставки в JS, то есть порядок исходника. Он стабилен между запусками. Swift не должен опираться на порядок словаря: где порядок важен, в данных есть массив (`PRESET_NAMES`, `ORDER`, `DESIGN_IDS`, `THEME_KEYS`, `SYSTEMS`…).
- **Сайдкары** — бинарные LE-файлы рядом с JSON: `{file, dtype, shape, sha256}`.

## Векторы (`Tests/Vectors/`)

| Файл | Что внутри | Допуск |
|---|---|---|
| `math/rng.json` | mulberry32: 23 сида × 256 `next()`; API `range/int/pick/chance/sign/gauss`; формулы сидов систем | побитово |
| `math/lcg.json` | LCG 1664525/1013904223 и 1103515245/12345, по 200 состояний | побитово |
| `math/noise.json` | `createNoise2D`: 5 сидов на сетке 32×32 [−300, 300]; `fbm2`; турбулентность FlightModel | побитово |
| `math/util.json` | `clamp/lerp/invLerp/remap/smoothstep` (3 вида), `damp/dampAngle/wrapAngle` | побитово |
| `math/jsmath.json` + `jsmath_<fn>.f64` | 16 функций × 4096 входов (строка `[in…, out]`, f64 LE), выходы Node | побитово, `pow` ≤ 1 ulp |
| `look/fields.json` | `gustField`, `cloudAt` (32×32 ±2000 м × 4 windOffset), `frontsAt` (3 набора), `sampleAtlas/Lace/Detail` | побитово |
| `weather/palette.json` | sRGB → linear всех hex пресетов, `COMPILED`, `blendPacked`, `applyGreen`, `unpack` | побитово |
| `ocean/wavebank_<preset>.json` × 8 | состояние банка, `heightAt/normalAt/velocityAt` на сетках near 13² и wide 11² × 2 фокуса × t {0; 12,5; 600,25}; `tOff`; `forward`. В storm дополнительно 30 с сглаживания calm → storm и качество medium | побитово |
| `ocean/coast_{first,fog}.json` + `.u8` | карта берега из живой игры (`quality=low`) и 500 точек `coastDistance` | побитово при данной карте |
| `heli/flight_*.json` × 4 | FlightModel, 600 шагов по 1/60 с: зависание (standard), крейсер без ассиста с препятствием, full + лебёдка + удар о воду, посадка на площадку. На каждом шаге записаны входы и 19 полей состояния, плюс события | хаос: все 600 шагов побитово |
| `mission/scoring.json` | Scorer по 4 сложностям (все STYLES, цепочки, once, неизвестный стиль), `breakdown`, 420 кейсов `medalsFor` | побитово |
| `mission/prepare.json` | `prepareDef` для 9 операций, endless (сид 20261016) и title | побитово |
| `text/ru_words.json` | числительные, плюрализация, стороны света, квадраты, часы, км (radio/words и mission/text) | побайтно |

Каждый файл содержит:

- **входы и вызовы:** `setup`, словами;
- **выходы.**

Swift-тест повторяет вызовы и сравнивает результат. Если сравнение побитовое, при расхождении он сообщает индекс, оба значения и расстояние в ulp (PLAN §5.4).

## Проверка (что делает `verify.mjs --browser`)

**1. Таблицы.** Каждая экспортированная таблица каждого модуля сериализуется заново из экземпляров модулей самой игры, запущенной с `?mission=0&autostart&quality=low&nohud&stub=audio`, и сравнивается с `Resources/Data`.

Последний прогон: 177 таблиц, 176 точных. `weather/palette.COMPILED` расходится на 1 ulp в 43 значениях: в Chromium `pow` берётся из glibc, а эталон — Node.

**2. Векторы.** Входы векторов прогоняются через модули страницы. Все прогоны совпали побитово:

- rng: 5888/5888;
- noise: 5120/5120;
- gust: 4096/4096;
- cloud: 4096/4096;
- medalsFor: 420/420.

Функции с `sin`/`cos`/`exp` отличаются на единицы ulp. Так и должно быть: эталон паритета — Node 22 (PLAN §5.2).

- frontsAt: ≤ 3 ulp;
- WaveBank `heightAt`: ≤ 16 ulp.

**3. Живое состояние.**

- настройки по умолчанию;
- `mission.def` op1 против `prepare.json`;
- число волн при качестве low;
- камера.

**4. Ошибки.** Ошибок консоли, ошибок страницы и упавших запросов должно быть 0.

## Ещё не реализовано (PLAN §4.1 / §5.3)

**Экспортёры:**

- `audio-traces`;
- `bake-meshes`;
- `bake-canvas`;
- `dump-glsl` (GLSL пока только перечислен в `omitted.glsl`);
- `render-goldens`;
- `audio-goldens`;
- `fetch-fonts`;
- `bake-icons` (SVG-строки уже есть в `icons.json`, отдельных `.svg` нет).

**Файлы данных и векторов:**

- `hud_tokens.json`;
- `text/ru_format.json` (Intl в Chromium);
- `rock.rgba`.

**Векторы, которые требуют W-задач веба:**

- weather run;
- ocean features/uniforms;
- world terrain/setup;
- hazards;
- fx;
- winch/ops;
- camera;
- survivors;
- `replay_op1`.

**Отличия от PLAN §4.3:**

- `source` — строка с sha, а не объект;
- список файлов-источников лежит в `sourceFiles`;
- в `jsmath` 4096 входов на функцию вместо 100 000, чтобы набор оставался компактным.
