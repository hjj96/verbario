'use strict';
/* ===== Игровые данные: модули корпуса, формы, орудия, эволюции, враги, роботы, сектора ===== */

const MAX_WEAPONS = 6;
const RUN_LENGTH = 1200; // 20 минут до финального босса
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

/* ---------- Модули корпуса (трансформация) ---------- */
// Ранги 1–2 общие, на 3-м ранге модуль ветвится (A/B), 3–5 — ранги ветки.
const PART_ORDER = ['core', 'legs', 'arms', 'head', 'back'];
const PARTS = {
  core: {
    name: 'Ядро', code: 'ЯД', color: '#ff5d73', role: 'Живучесть',
    ranks: [
      { name: 'Укреплённый каркас', d: '+20 прочности, +1 броня', st: { maxHp: 20, armor: 1 } },
      { name: 'Термоядерная ячейка', d: '+20 прочности, регенерация +0,5/с', st: { maxHp: 20, regen: 0.5 } },
    ],
    branches: {
      A: { name: 'Бастион', tag: 'Тяжёлая броня', color: '#ffb43d', ranks: [
        { name: 'Бастион', d: '+30 прочности, +2 брони. Шипы: обидчик получает урон', st: { maxHp: 30, armor: 2 } },
        { name: 'Зеркальная броня', d: '+30 прочности, +1 броня. Шипы ×2, 12% шанс поглотить удар', st: { maxHp: 30, armor: 1 } },
        { name: 'Цитадель', d: '+50 прочности, +2 брони. Каждый удар по вам рождает ударную волну', st: { maxHp: 50, armor: 2 } },
      ] },
      B: { name: 'Феникс', tag: 'Энергоядро', color: '#ff6a2b', ranks: [
        { name: 'Реактор «Феникс»', d: 'Регенерация +1/с. Энергощит поглощает удар (перезарядка 12 с)', st: { regen: 1, maxHp: 10 } },
        { name: 'Сверхновая', d: 'Регенерация +0,5/с. Щит восстанавливается за 8 с, при пробое — взрыв', st: { regen: 0.5, maxHp: 10 } },
        { name: 'Вечный двигатель', d: 'Регенерация +1/с. Раз за забег — воскрешение с огненным взрывом', st: { regen: 1, maxHp: 20 } },
      ] },
    },
  },
  legs: {
    name: 'Шасси', code: 'ШС', color: '#5dff9b', role: 'Мобильность',
    ranks: [
      { name: 'Сервоприводы', d: 'Скорость +10%', st: { speed: 0.1 } },
      { name: 'Амортизаторы', d: 'Скорость +6%, перезарядка рывка −20%', st: { speed: 0.06, dashCd: 0.2 } },
    ],
    branches: {
      A: { name: 'Гусеницы', tag: 'Давление', color: '#ffd23f', ranks: [
        { name: 'Гусеничная база', d: 'Давите врагов на ходу. Отбрасывание по вам −80%, +15 прочности', st: { kbRes: 0.8, maxHp: 15 } },
        { name: 'Бронеюбка', d: 'Урон давления ×2, броня +1', st: { armor: 1 } },
        { name: 'Таран', d: 'Рывок становится таранным ударом: урон и оглушение по пути', st: { speed: 0.05 } },
      ] },
      B: { name: 'Дюзы', tag: 'Реактивный ход', color: '#3fe0ff', ranks: [
        { name: 'Реактивные дюзы', d: 'Скорость +12%, 2 заряда рывка, за рывком тянется пламя', st: { speed: 0.12, dashCharges: 1 } },
        { name: 'Форсаж', d: 'Скорость +8%, перезарядка рывка −20%, пламя жарче', st: { speed: 0.08, dashCd: 0.2 } },
        { name: 'Фазовый скачок', d: 'Рывок — телепорт со взрывами в начале и конце. 3 заряда', st: { speed: 0.05, dashCharges: 1 } },
      ] },
      C: { name: 'Паучьи лапы', tag: 'Арахнид', color: '#c6ff3d', ranks: [
        { name: 'Паучьи лапы', d: 'Шесть лап: паутина, лёд и кислота не замедляют. Скорость +8%, +10 прочности', st: { speed: 0.08, maxHp: 10 } },
        { name: 'Жала', d: 'Концы лап жалят ближайших врагов: урон и коррозия до трёх целей каждые 0,5 с', st: { speed: 0.04 } },
        { name: 'Прыжок паука', d: 'Рывок — прыжок по дуге: при приземлении ударная волна и паутина, вязнущий в ней Рой замедлен', st: { speed: 0.04, dashCharges: 1 } },
      ] },
    },
  },
  arms: {
    name: 'Манипуляторы', code: 'МН', color: '#ffb43d', role: 'Огневая мощь',
    ranks: [
      { name: 'Усиленные приводы', d: 'Урон +10%', st: { might: 0.1 } },
      { name: 'Стабилизаторы', d: 'Урон +8%, скорость снарядов +15%', st: { might: 0.08, projSpd: 0.15 } },
    ],
    branches: {
      A: { name: 'Тяжёлые орудия', tag: 'Калибр', color: '#ff8a3d', ranks: [
        { name: 'Тяжёлые орудия', d: 'Урон +18%, площадь +12%, отбрасывание +50%', st: { might: 0.18, area: 0.12, kb: 0.5 } },
        { name: 'Двойной калибр', d: 'Урон +15%, площадь +12%', st: { might: 0.15, area: 0.12 } },
        { name: 'Осадный режим', d: 'Урон +20%. Стоя на месте 0,7 с: ещё +35% урона и +20% площади', st: { might: 0.2 } },
      ] },
      B: { name: 'Скорострельные', tag: 'Темп', color: '#ffe66b', ranks: [
        { name: 'Гатлинги', d: 'Перезарядка −10%, +1 снаряд ко всем орудиям', st: { cdr: 0.1, amount: 1 } },
        { name: 'Ленточная подача', d: 'Перезарядка −8%, скорость снарядов +15%', st: { cdr: 0.08, projSpd: 0.15 } },
        { name: 'Шквал', d: 'Перезарядка −8%, ещё +1 снаряд', st: { cdr: 0.08, amount: 1 } },
      ] },
      C: { name: 'Многорук', tag: 'Мини-пушки', color: '#46e3ff', ranks: [
        { name: 'Многорук', d: 'Из-за плеч выдвигаются две малые руки с мини-пушками — сами бьют по разным целям. Урон +6%', st: { might: 0.06 } },
        { name: 'Гидра', d: 'Ещё две руки с мини-пушками (всего четыре), перезарядка −5%', st: { cdr: 0.05 } },
        { name: 'Сторукий', d: 'Шесть рук. Мини-пушки бьют чаще и пробивают насквозь', st: { might: 0.08 } },
      ] },
    },
  },
  head: {
    name: 'Сенсоры', code: 'СН', color: '#b38bff', role: 'Точность и добыча',
    ranks: [
      { name: 'Оптика', d: 'Радиус сбора +30%', st: { magnet: 0.3 } },
      { name: 'Анализатор', d: 'Шанс крита +5%, опыт +8%', st: { crit: 0.05, growth: 0.08 } },
    ],
    branches: {
      A: { name: 'Тактический ИИ', tag: 'Криты', color: '#ff4d5e', ranks: [
        { name: 'Тактический ИИ', d: 'Шанс крита +10%, критический урон +40%', st: { crit: 0.1, critDmg: 0.4 } },
        { name: 'Целеуказатель', d: 'Крит +8%. Криты помечают цель: +15% урона по ней', st: { crit: 0.08 } },
        { name: 'Предиктор', d: 'Крит +7%, крит. урон +60%. Криты бьют цепной молнией', st: { crit: 0.07, critDmg: 0.6 } },
      ] },
      B: { name: 'Глубокий радар', tag: 'Ресурсы', color: '#5dff9b', ranks: [
        { name: 'Глубокий радар', d: 'Радиус сбора +50%, опыт +12%, удача +15%', st: { magnet: 0.5, growth: 0.12, luck: 0.15 } },
        { name: 'Сканер поля', d: 'Опыт +10%, удача +15%. Каждые 40 с — импульс, стягивающий кристаллы', st: { growth: 0.1, luck: 0.15 } },
        { name: 'Всевидящее око', d: 'Опыт +15%, лом +50%. Контейнеры дают доп. награду', st: { growth: 0.15, greed: 0.5, luck: 0.1 } },
      ] },
    },
  },
  back: {
    name: 'Генератор', code: 'ГН', color: '#3fe0ff', role: 'Энергия',
    ranks: [
      { name: 'Охладитель', d: 'Перезарядка −8%', st: { cdr: 0.08 } },
      { name: 'Конденсатор', d: 'Длительность +15%, заряд овердрайва +15%', st: { duration: 0.15, odRate: 0.15 } },
    ],
    branches: {
      A: { name: 'Крылья-излучатели', tag: 'Перья', color: '#ff4f9a', ranks: [
        { name: 'Крылья-излучатели', d: 'Перезарядка −8%. Крылья выпускают самонаводящиеся перья', st: { cdr: 0.08 } },
        { name: 'Размах', d: 'Перезарядка −6%, вдвое больше перьев', st: { cdr: 0.06 } },
        { name: 'Серафим', d: 'Перезарядка −6%, перья мощнее, овердрайв копится на 30% быстрее', st: { cdr: 0.06, odRate: 0.3 } },
      ] },
      B: { name: 'Гало-генератор', tag: 'Аура', color: '#9dffcf', ranks: [
        { name: 'Гало-генератор', d: 'Длительность +15%, площадь +10%. Жгучее кольцо вокруг корпуса', st: { duration: 0.15, area: 0.1 } },
        { name: 'Гироскоп', d: 'Длительность +10%, овердрайв длится на 3 с дольше, кольцо мощнее', st: { duration: 0.1, odDur: 3 } },
        { name: 'Сингулярность', d: 'Площадь +15%. Запуск овердрайва рождает гравитационный взрыв', st: { area: 0.15 } },
      ] },
      C: { name: 'Крылья сокола', tag: 'Полёт', color: '#ffd36b', ranks: [
        { name: 'Крылья сокола', d: 'Робот парит над полом: кислота, огонь и паутина не действуют. Скорость +10%', st: { speed: 0.1 } },
        { name: 'Пикирование', d: 'Рывок — бросок сокола: режет и отбрасывает всех на пути', st: { dashCd: 0.15 } },
        { name: 'Буревестник', d: 'В полёте взмах крыльев раз в 2,5 с — порыв ветра раскидывает Рой и ранит его', st: { speed: 0.05, area: 0.1 } },
      ] },
    },
  },
};
function partRankDef(part, rank, branch) {
  const P = PARTS[part];
  if (rank <= 0) return null;
  if (rank <= 2) return P.ranks[rank - 1];
  return P.branches[branch].ranks[rank - 3];
}

const FORMS = [
  { name: 'Прототип', code: 'I', at: 0, scale: 1.0, st: {} },
  { name: 'Боевая единица', code: 'II', at: 4, scale: 1.07, st: { might: 0.05, maxHp: 10 }, d: 'Урон +5%, прочность +10' },
  { name: 'Штурмовик', code: 'III', at: 9, scale: 1.14, st: { might: 0.1, maxHp: 25, speed: 0.04 }, d: 'Урон +10%, прочность +25, скорость +4%' },
  { name: 'Колосс', code: 'IV', at: 15, scale: 1.22, st: { might: 0.18, maxHp: 45, armor: 1, speed: 0.04 }, d: 'Урон +18%, прочность +45, броня +1' },
  { name: 'Ω-Аватар', code: 'Ω', at: 22, scale: 1.3, st: { might: 0.3, maxHp: 70, armor: 2, cdr: 0.06, speed: 0.06 }, d: 'Урон +30%, прочность +70, броня +2, перезарядка −6%' },
];

/* ---------- Орудия ---------- */
const WEAPONS = {
  blaster: {
    name: 'Импульсный бластер', color: '#46e3ff', part: 'arms', evo: 'annihilator',
    desc: 'Очередь энергетических импульсов по ближайшим целям.',
    base: { dmg: 10, cd: 0.95, amount: 1, speed: 470, pierce: 1, size: 5, life: 1.3 },
    levels: [
      { d: '+1 импульс в очереди', amount: 1 },
      { d: 'Урон +5', dmg: 5 },
      { d: '+1 импульс, пробивание +1', amount: 1, pierce: 1 },
      { d: 'Урон +5, перезарядка −0,1 с', dmg: 5, cd: -0.1 },
      { d: '+1 импульс в очереди', amount: 1 },
      { d: 'Пробивание +1, урон +6', pierce: 1, dmg: 6 },
      { d: 'Урон +8, перезарядка −0,15 с', dmg: 8, cd: -0.15 },
    ],
  },
  blade: {
    name: 'Плазменный клинок', color: '#ff5fd2', part: 'core', evo: 'bladestorm',
    desc: 'Широкий плазменный взмах перед корпусом. Отбрасывает врагов.',
    base: { dmg: 18, cd: 1.3, area: 1, range: 78, arc: 2.6, amount: 1, kb: 150, burn: 0 },
    levels: [
      { d: 'Второй взмах — за спиной', amount: 1 },
      { d: 'Урон +8', dmg: 8 },
      { d: 'Площадь +20%', area: 0.2 },
      { d: 'Урон +8, перезарядка −0,15 с', dmg: 8, cd: -0.15 },
      { d: 'Третий взмах', amount: 1 },
      { d: 'Площадь +20%', area: 0.2 },
      { d: 'Урон +12, взмахи поджигают', dmg: 12, burn: 5 },
    ],
  },
  drones: {
    name: 'Орбитальные дроны', color: '#7dffb0', part: 'back', evo: 'halo',
    desc: 'Боевые дроны кружат вокруг корпуса и таранят врагов.',
    base: { dmg: 9, amount: 2, orbit: 64, rot: 2.6, icd: 0.45, size: 8, kb: 70, area: 1 },
    levels: [
      { d: '+1 дрон', amount: 1 },
      { d: 'Урон +5', dmg: 5 },
      { d: '+1 дрон, орбита шире', amount: 1, area: 0.12 },
      { d: 'Скорость вращения +30%', rot: 0.8 },
      { d: '+1 дрон', amount: 1 },
      { d: 'Урон +6', dmg: 6 },
      { d: '+1 дрон, орбита шире', amount: 1, area: 0.15 },
    ],
  },
  arc: {
    name: 'Дуговой разрядник', color: '#c9a6ff', part: 'head', evo: 'stormdome',
    desc: 'Разряд перескакивает между врагами. Может оглушить.',
    base: { dmg: 13, cd: 1.15, chains: 3, range: 115, amount: 1, stun: 0.12, reach: 380 },
    levels: [
      { d: '+2 перескока', chains: 2 },
      { d: 'Урон +5', dmg: 5 },
      { d: '+1 разряд', amount: 1 },
      { d: 'Перезарядка −0,15 с', cd: -0.15 },
      { d: '+2 перескока, дальность +25', chains: 2, range: 25 },
      { d: 'Урон +6', dmg: 6 },
      { d: '+1 разряд, шанс оглушения +15%', amount: 1, stun: 0.15 },
    ],
  },
  missiles: {
    name: 'Ракетный рой', color: '#ff9a3d', part: 'head', evo: 'carpet',
    desc: 'Самонаводящиеся ракеты со взрывом по площади.',
    base: { dmg: 16, cd: 2.1, amount: 2, area: 1, blast: 42, speed: 240, turn: 4.2, life: 3.2 },
    levels: [
      { d: '+1 ракета', amount: 1 },
      { d: 'Радиус взрыва +20%', area: 0.2 },
      { d: 'Урон +6', dmg: 6 },
      { d: '+1 ракета', amount: 1 },
      { d: 'Перезарядка −0,3 с', cd: -0.3 },
      { d: 'Радиус +20%, урон +6', area: 0.2, dmg: 6 },
      { d: '+2 ракеты', amount: 2 },
    ],
  },
  flamer: {
    name: 'Огнемёт', color: '#ff6a2b', part: 'back', evo: 'supernova',
    desc: 'Струя плазменного огня. Поджигает всё на пути.',
    base: { dmg: 4, cd: 2.6, dur: 1.2, cone: 0.6, range: 1, burn: 3, amount: 1, rate: 38, area: 1 },
    levels: [
      { d: 'Дальность +20%', range: 0.2 },
      { d: 'Урон +2, горение +2', dmg: 2, burn: 2 },
      { d: 'Длительность струи +0,4 с', dur: 0.4 },
      { d: 'Конус шире, площадь +20%', cone: 0.25, area: 0.2 },
      { d: 'Перезарядка −0,4 с', cd: -0.4 },
      { d: 'Урон +2, горение +3', dmg: 2, burn: 3 },
      { d: 'Второе сопло — назад', amount: 1 },
    ],
  },
  mines: {
    name: 'Сейсмомины', color: '#ffe066', part: 'legs', evo: 'cluster',
    desc: 'Мины остаются позади и взрываются при приближении врага.',
    base: { dmg: 28, cd: 1.6, amount: 1, blast: 55, area: 1, max: 6, arm: 0.5, trig: 30, life: 12, stun: 0 },
    levels: [
      { d: 'Лимит мин +2', max: 2 },
      { d: 'Урон +8', dmg: 8 },
      { d: 'Радиус взрыва +20%', area: 0.2 },
      { d: 'Перезарядка −0,3 с', cd: -0.3 },
      { d: '+1 мина за раз', amount: 1 },
      { d: 'Урон +10', dmg: 10 },
      { d: 'Радиус +20%, взрыв оглушает', area: 0.2, stun: 0.5 },
    ],
  },
  gravity: {
    name: 'Гравитон', color: '#a77bff', part: 'core', evo: 'horizon',
    desc: 'Сингулярность стягивает врагов в точку и перемалывает.',
    base: { dmg: 5, cd: 4.6, dur: 2.5, radius: 95, area: 1, pull: 140, amount: 1, collapse: 0, tick: 0.25 },
    levels: [
      { d: 'Площадь +20%', area: 0.2 },
      { d: 'Урон +3', dmg: 3 },
      { d: 'Длительность +1 с', dur: 1 },
      { d: '+1 сингулярность', amount: 1 },
      { d: 'Площадь +20%, притяжение сильнее', area: 0.2, pull: 40 },
      { d: 'Урон +4', dmg: 4 },
      { d: 'Схлопывание: взрыв 60 урона', collapse: 60 },
    ],
  },
  cryo: {
    name: 'Криолуч', color: '#8fe8ff', part: 'arms', evo: 'zero',
    desc: 'Луч холода замедляет и замораживает всё на линии.',
    base: { dmg: 3, cd: 3.2, dur: 1.8, range: 300, width: 10, slow: 0.35, frost: 9, amount: 1, freeze: 1.5 },
    levels: [
      { d: 'Урон +1,5', dmg: 1.5 },
      { d: 'Длительность луча +0,6 с', dur: 0.6 },
      { d: 'Дальность +60, луч шире', range: 60, width: 3 },
      { d: '+1 луч', amount: 1 },
      { d: 'Урон +2', dmg: 2 },
      { d: 'Перезарядка −0,6 с', cd: -0.6 },
      { d: '+1 луч, заморозка дольше', amount: 1, freeze: 1 },
    ],
  },
  rail: {
    name: 'Рельсотрон', color: '#eaf6ff', part: 'back', evo: 'lance',
    desc: 'Мгновенный сверхзвуковой выстрел, пробивающий всё насквозь.',
    base: { dmg: 55, cd: 3.0, width: 12, length: 950, amount: 1, kb: 90, stun: 0 },
    levels: [
      { d: 'Урон +20', dmg: 20 },
      { d: 'Перезарядка −0,4 с', cd: -0.4 },
      { d: '+1 выстрел', amount: 1 },
      { d: 'Ширина луча +50%', width: 6 },
      { d: 'Урон +25', dmg: 25 },
      { d: 'Перезарядка −0,4 с', cd: -0.4 },
      { d: '+1 выстрел, попадание оглушает', amount: 1, stun: 0.5 },
    ],
  },
  saw: {
    name: 'Пила-диск', color: '#ffcf8a', part: 'legs', evo: 'sawmill',
    desc: 'Диск рикошетит от врага к врагу.',
    base: { dmg: 14, cd: 1.8, bounces: 3, speed: 360, size: 10, amount: 1, area: 1, corrode: 0 },
    levels: [
      { d: '+2 рикошета', bounces: 2 },
      { d: 'Урон +5', dmg: 5 },
      { d: '+1 диск', amount: 1 },
      { d: 'Размер +20%', area: 0.2 },
      { d: '+2 рикошета, скорость +20%', bounces: 2, speed: 70 },
      { d: 'Урон +6', dmg: 6 },
      { d: '+1 диск, порезы вызывают коррозию', amount: 1, corrode: 0.15 },
    ],
  },
  glaive: {
    name: 'Световая глефа', color: '#62f0ff', part: 'head', evo: 'bladedance',
    desc: 'Вращающиеся световые мечи летят по дуге бумерангом, режут всё на пути туда и обратно.',
    base: { dmg: 16, cd: 2.2, amount: 1, range: 210, size: 15, dur: 1.15, area: 1, stun: 0 },
    levels: [
      { d: '+1 глефа', amount: 1 },
      { d: 'Урон +6', dmg: 6 },
      { d: 'Дальность +25%', range: 52 },
      { d: '+1 глефа', amount: 1 },
      { d: 'Клинок длиннее на 30%', area: 0.3 },
      { d: 'Урон +8, перезарядка −0,3 с', dmg: 8, cd: -0.3 },
      { d: '+1 глефа, удары оглушают', amount: 1, stun: 0.3 },
    ],
  },
  magnet: {
    name: 'Электромагнит', color: '#ff5a6e', part: 'arms', evo: 'magstorm',
    desc: 'Хватает ближайших врагов, раскручивает и швыряет их в толпу. Заодно стягивает кристаллы.',
    base: { dmg: 22, cd: 3.2, amount: 2, range: 170, speed: 560, slam: 26, blast: 0, area: 1 },
    levels: [
      { d: '+1 захват', amount: 1 },
      { d: 'Урон +8', dmg: 8 },
      { d: 'Радиус захвата +25%', range: 42 },
      { d: '+1 захват', amount: 1 },
      { d: 'Перезарядка −0,5 с', cd: -0.5 },
      { d: 'Урон +10, падение взрывается', dmg: 10, blast: 46 },
      { d: '+2 захвата', amount: 2 },
    ],
  },
  nanites: {
    name: 'Нанорой', color: '#8dff6a', part: 'core', evo: 'goo',
    desc: 'Облако нанитов вокруг корпуса разъедает броню врагов.',
    base: { dmg: 4, tick: 0.36, radius: 55, area: 1, corrode: 0.12, leech: 0 },
    levels: [
      { d: 'Радиус +20%', area: 0.2 },
      { d: 'Урон +2', dmg: 2 },
      { d: 'Частота атак +20%', tick: -0.06 },
      { d: 'Радиус +20%', area: 0.2 },
      { d: 'Урон +2, коррозия сильнее', dmg: 2, corrode: 0.08 },
      { d: 'Радиус +20%', area: 0.2 },
      { d: 'Наниты чинят корпус за счёт врагов', leech: 0.3 },
    ],
  },
  shock: {
    name: 'Ударная волна', color: '#ffa07a', part: 'legs', evo: 'seismic',
    desc: 'Кольцевой импульс отбрасывает и ранит всех вокруг.',
    base: { dmg: 12, cd: 2.4, radius: 110, area: 1, kb: 280, amount: 1, stun: 0 },
    levels: [
      { d: 'Радиус +20%', area: 0.2 },
      { d: 'Урон +6', dmg: 6 },
      { d: '+1 кольцо', amount: 1 },
      { d: 'Перезарядка −0,3 с', cd: -0.3 },
      { d: 'Радиус +20%', area: 0.2 },
      { d: 'Урон +8', dmg: 8 },
      { d: 'Кольца оглушают', stun: 0.4 },
    ],
  },
};
const WEAPON_ORDER = ['blaster', 'blade', 'drones', 'arc', 'missiles', 'flamer', 'mines', 'gravity', 'cryo', 'rail', 'saw', 'nanites', 'shock', 'glaive', 'magnet'];

const EVOS = {
  annihilator: { from: 'blaster', name: 'Аннигилятор', color: '#bff6ff', desc: 'Залпы тяжёлых плазменных сфер: бесконечное пробивание и микровзрывы.', base: { dmg: 26, cd: 0.55, amount: 3, speed: 560, size: 10, life: 1.6, blast: 30 } },
  bladestorm: { from: 'blade', name: 'Вихрь клинков', color: '#ff9ae6', desc: 'Три клинка вращаются вокруг корпуса и тянут энергию из врагов. Каждые 2 с — круговой разрез.', base: { dmg: 20, amount: 3, orbit: 88, rot: 5.5, icd: 0.25, size: 26, wave: 40, cd: 2, leech: 0.25, area: 1 } },
  halo: { from: 'drones', name: 'Гало-рой', color: '#9dffcf', desc: 'Двенадцать дронов на двух встречных орбитах. Каждый стреляет лазером.', base: { dmg: 16, amount: 12, orbit: 72, orbit2: 125, rot: 2.8, icd: 0.35, size: 9, laser: 10, lcd: 1.2, area: 1 } },
  stormdome: { from: 'arc', name: 'Грозовой купол', color: '#e2d4ff', desc: 'Молнии бьют с неба по всему экрану и прыгают по врагам. Каждые 3 с — удар грома.', base: { dmg: 22, cd: 0.35, chains: 5, range: 130, stun: 0.3, big: 80, bigCd: 3, area: 1 } },
  carpet: { from: 'missiles', name: 'Ковровая бомбардировка', color: '#ffb35c', desc: 'Рой микроракет по всем целям на экране. Взрывы оставляют пламя.', base: { dmg: 18, cd: 1.6, amount: 10, blast: 52, speed: 300, turn: 6, life: 3, fire: 4, area: 1 } },
  supernova: { from: 'flamer', name: 'Дыхание сверхновой', color: '#ffd36b', desc: 'Три вращающихся потока плазмы. Горящие враги взрываются при смерти.', base: { dmg: 6, amount: 3, rate: 60, burn: 10, spin: 2.2, range: 1.25, cone: 0.25, burst: 20, area: 1 } },
  cluster: { from: 'mines', name: 'Кластерное поле', color: '#fff08a', desc: 'Мины сыплются на ходу, каждый взрыв разбрасывает суббоеприпасы.', base: { dmg: 34, cd: 0.4, amount: 1, blast: 60, max: 30, arm: 0.3, trig: 32, life: 14, bomblets: 5, area: 1, stun: 0.3 } },
  horizon: { from: 'gravity', name: 'Горизонт событий', color: '#c08bff', desc: 'Блуждающая чёрная дыра стирает ослабших врагов и взрывается каждые 6 с.', base: { dmg: 12, radius: 140, pull: 190, exec: 0.15, burst: 150, cycle: 6, tick: 0.25, area: 1 } },
  zero: { from: 'cryo', name: 'Абсолютный ноль', color: '#d8f7ff', desc: 'Три криолуча. Замороженные враги получают +50% урона и раскалываются на осколки.', base: { dmg: 5, cd: 1.2, dur: 3.2, range: 340, width: 16, slow: 0.5, frost: 14, amount: 3, freeze: 2.5, shards: 6 } },
  lance: { from: 'rail', name: 'Орбитальное копьё', color: '#ffffff', desc: 'Рельсовый выстрел плюс удары с орбиты по скоплениям врагов.', base: { dmg: 160, cd: 2.2, amount: 3, radius: 70, rail: 90, width: 16, length: 1000, area: 1 } },
  sawmill: { from: 'saw', name: 'Пилорама', color: '#ffdcaa', desc: 'Огромные пилы рикошетят от краёв экрана и режут всё на пути.', base: { dmg: 24, cd: 7, amount: 4, dur: 6, speed: 420, size: 18, icd: 0.3, area: 1 } },
  goo: { from: 'nanites', name: 'Серая слизь', color: '#c9ffb8', desc: 'Огромное облако нанитов. Каждая смерть внутри порождает новое облако.', base: { dmg: 9, tick: 0.25, radius: 105, corrode: 0.25, leech: 0.5, cloud: 40, area: 1 } },
  bladedance: { from: 'glaive', name: 'Танец клинков', color: '#bffbff', desc: 'Шесть световых мечей кружат вокруг корпуса и каждые 2,5 с разлетаются звездой и возвращаются.', base: { dmg: 30, amount: 6, orbit: 66, rot: 3.4, cycle: 2.5, range: 250, size: 22, icd: 0.25, area: 1 } },
  magstorm: { from: 'magnet', name: 'Магнитная буря', color: '#ff9aa6', desc: 'Вихрь затягивает врагов на орбиту вокруг корпуса — они таранят остальных — и каждые 3 с вышвыривает их во все стороны.', base: { dmg: 34, amount: 10, range: 240, orbit: 74, rot: 3.6, cycle: 3, speed: 620, area: 1 } },
  seismic: { from: 'shock', name: 'Сейсмический молот', color: '#ffb59a', desc: 'Тройные кольца сокрушают и оглушают, по земле расходятся раскалённые трещины.', base: { dmg: 30, cd: 1.8, radius: 220, amount: 3, kb: 320, stun: 0.6, fissures: 6, fdmg: 40, area: 1 } },
};
const EVO_RANK = 3; // какой ранг модуля нужен для эволюции

/* ---------- Враги ---------- */
// цветные варианты Роя: цвет рёбер машины — её поведение
const VARIANTS = {
  ice: { name: 'Ледяной', col: '#4fc3ff', d: 'Плюётся ледяными сгустками: попадание на 1,6 с замедляет робота.' },
  acid: { name: 'Кислотный', col: '#7dff3a', d: 'Погибая, оставляет лужу кислоты — она жжёт робота.' },
  shield: { name: 'Щитовой', col: '#ffd23f', d: 'Под энергощитом: сначала пробейте щит, потом корпус.' },
  blink: { name: 'Фазовый', col: '#b56bff', d: 'Прыгает сквозь пространство и за два-три скачка оказывается рядом.' },
  volatile: { name: 'Взрывной', col: '#fff1c8', d: 'Через полсекунды после гибели взрывается — задевает и робота, и своих.' },
};
const VAR_TYPES = ['bug', 'tank', 'mini', 'charger', 'gunner', 'splitter', 'spitter'];
const VAR_W = { rust: { volatile: 3, shield: 3, ice: 1.5, acid: 1, blink: 1 }, neon: { blink: 3, ice: 3, shield: 1.5, volatile: 1, acid: 1 }, hive: { acid: 3, volatile: 2.5, blink: 1.5, shield: 1, ice: 1 },
  cryo: { ice: 3.5, shield: 2.5, volatile: 1.5, blink: 1, acid: 0.5 }, orbit: { blink: 3, volatile: 2.5, shield: 2, ice: 1, acid: 1 } };
const ENEMIES = {
  bug: { name: 'Клещ', r: 9, hp: 6, spd: 72, dmg: 6, xp: 1, ai: 'chase', acc: '#ffd23f', d: 'Базовая единица Роя. Берёт числом.' },
  tank: { name: 'Броневик', r: 15, hp: 40, spd: 44, dmg: 11, xp: 4, ai: 'chase', armor: 0.3, kbRes: 0.6, acc: '#ff8a3d', d: 'Толстый панцирь гасит 30% урона.' },
  kami: { name: 'Искровик', r: 8, hp: 4, spd: 128, dmg: 16, xp: 1, ai: 'kami', acc: '#ff3b3b', d: 'Дрон-камикадзе. Взрывается рядом с целью — держите дистанцию.' },
  gunner: { name: 'Стрелок', r: 12, hp: 18, spd: 58, dmg: 7, xp: 3, ai: 'ranged', acc: '#ff5fd2', d: 'Держится на расстоянии и стреляет.' },
  charger: { name: 'Рогач', r: 13, hp: 30, spd: 52, dmg: 14, xp: 3, ai: 'charger', acc: '#ffb43d', kbRes: 0.4, d: 'Замирает, целится и бросается вперёд.' },
  splitter: { name: 'Делитель', r: 14, hp: 26, spd: 56, dmg: 9, xp: 2, ai: 'chase', split: 'mini', acc: '#8dff6a', d: 'При гибели распадается на три осколка.' },
  mini: { name: 'Осколок', r: 7, hp: 6, spd: 98, dmg: 5, xp: 1, ai: 'chase', acc: '#8dff6a', d: 'Быстрый обломок Делителя.' },
  shielder: { name: 'Щитоносец', r: 14, hp: 36, spd: 46, dmg: 9, xp: 4, ai: 'shielder', acc: '#a77bff', d: 'Прикрывает соседей щитом: −50% урона по ним.' },
  medic: { name: 'Ремонтник', r: 11, hp: 24, spd: 62, dmg: 6, xp: 4, ai: 'medic', acc: '#5dff9b', d: 'Чинит соседей. Уничтожайте первым.' },
  blinker: { name: 'Фантом', r: 10, hp: 20, spd: 64, dmg: 9, xp: 3, ai: 'blinker', acc: '#ff4fd8', d: 'Телепортируется рядом с вами.' },
  eater: { name: 'Пожиратель', r: 12, hp: 50, spd: 84, dmg: 8, xp: 5, ai: 'eater', acc: '#b38bff', d: 'Поедает кристаллы опыта и растёт. При гибели отдаёт всё с процентами.' },
  spitter: { name: 'Плевун', r: 12, hp: 26, spd: 50, dmg: 6, xp: 3, ai: 'spitter', acc: '#c6ff3d', d: 'Плюётся кислотой, оставляя лужи.' },
  nest: { name: 'Гнездо Роя', r: 26, hp: 1, spd: 0, dmg: 0, xp: 0, ai: 'nest', acc: '#ff3b5c', kbRes: 1, d: 'Улей-матка: раскрывает лепестки и выпускает машины, пока цело. Через 45 с созревает и начинает выпускать элиту. Награда — опыт, лом и часто контейнер с улучшением.' },
  egg: { name: 'Кладка', r: 9, hp: 22, spd: 0, dmg: 0, xp: 1, ai: 'egg', acc: '#c6ff3d', kbRes: 1, d: 'Кладка Паучихи. Разбейте, пока не вылупился выводок.' },
  prop: { name: 'Контейнер снабжения', r: 13, hp: 6, spd: 0, dmg: 0, xp: 0, ai: 'none', prop: true, acc: '#ffb43d', d: 'Разбейте — внутри ремкомплекты и полезные устройства.' },
};
const ENEMY_CODEX = ['bug', 'tank', 'kami', 'gunner', 'charger', 'splitter', 'shielder', 'medic', 'blinker', 'eater', 'spitter'];

// t — желаемая длительность боя (с): запас прочности босса подстраивается под мощь игрока
const BOSSES = {
  hammer: { name: 'МОЛОТ', title: 'Штурмовой шагатель', r: 34, hp: 3000, spd: 58, dmg: 18, color: '#ff8a3d', t: 55, d: 'Сотрясает землю и бросается в таранную атаку.' },
  hive: { name: 'УЛЕЙ', title: 'Матка Роя', r: 42, hp: 6500, spd: 34, dmg: 16, color: '#ffd23f', t: 65, d: 'Выпускает кольца снарядов и рои камикадзе.' },
  serpent: { name: 'ЗМЕЙ', title: 'Сегментный пожиратель', r: 24, hp: 10000, spd: 125, dmg: 20, color: '#8dff6a', segs: 16, t: 75, d: 'Гигантская механическая многоножка. Сегменты стреляют.' },
  reaper: { name: 'ЖНЕЦ', title: 'Клинковый призрак', r: 28, hp: 4200, spd: 92, dmg: 17, color: '#ff4fd8', t: 60, d: 'Рывки сквозь поле, вихрь плазменных кос, косы-бумеранги.' },
  arachna: { name: 'ПАУЧИХА', title: 'Матка-шагатель', r: 40, hp: 8000, spd: 60, dmg: 18, color: '#c6ff3d', t: 70, d: 'Прыгает, оплетает поле паутиной, откладывает кладки.' },
  core: { name: 'ЯДРО РОЯ', title: 'Источник', r: 56, hp: 26000, spd: 26, dmg: 24, color: '#ff3d5a', t: 140, d: 'Сердце Роя. Три фазы, лазеры и щиты.' },
};
// что меняется в бою на второй и третьей фазе
const BOSS_PHASE_TXT = {
  hammer: ['Удары молота рождают ударную волну', 'Двойной таран, след из огня'],
  hive: ['Залпы плотнее, спираль в три луча', 'Улей идёт на таран'],
  serpent: ['Броски оставляют кислоту, стреляет вдвое больше сегментов', 'Скорость растёт, двойной бросок'],
  reaper: ['Косы-бумеранги возвращаются дважды', 'Призрачные двойники повторяют рывки'],
  arachna: ['Паутина гуще, кладки вылупляются быстрее', 'Прыжок за прыжком'],
  core: ['Лазеры!', 'Уничтожьте щитовые узлы'],
};
// у каждого сектора своя тройка боссов; финал — всегда Ядро
const BOSS_LINEUP = { rust: ['hammer', 'hive', 'serpent'], neon: ['reaper', 'serpent', 'arachna'], hive: ['arachna', 'reaper', 'hive'], cryo: ['serpent', 'arachna', 'hammer'], orbit: ['reaper', 'hive', 'serpent'] };
function bossSchedule(sid) {
  const L = BOSS_LINEUP[sid] || BOSS_LINEUP.rust;
  return [{ t: 300, id: L[0] }, { t: 600, id: L[1] }, { t: 900, id: L[2] }, { t: 1200, id: 'core', final: true }];
}
const BOSS_SCHEDULE = bossSchedule('rust');
// лейтенанты Роя — мини-боссы между большими боссами
const LIEUTENANT_TIMES = [150, 450, 750, 1050];

// Волны по минутам: скорость появления (в секунду), лимит живых, состав
const WAVES = [
  { rate: 1.5, cap: 40, pool: { bug: 10 } },
  { rate: 2.6, cap: 70, pool: { bug: 8, tank: 2 } },
  { rate: 3.8, cap: 100, pool: { bug: 7, tank: 2, kami: 3 } },
  { rate: 5, cap: 130, pool: { bug: 6, tank: 3, kami: 2, splitter: 2 } },
  { rate: 5.6, cap: 150, pool: { bug: 5, tank: 3, kami: 2, splitter: 2, gunner: 2 } },
  { rate: 5, cap: 140, pool: { bug: 6, tank: 3, gunner: 2, kami: 2 } },
  { rate: 7.5, cap: 190, pool: { bug: 4, tank: 3, charger: 3, gunner: 2, splitter: 2 } },
  { rate: 10, cap: 240, pool: { bug: 4, tank: 3, charger: 2, gunner: 2, shielder: 2, kami: 2 } },
  { rate: 11.5, cap: 270, pool: { bug: 4, tank: 3, charger: 2, gunner: 2, shielder: 2, medic: 2, splitter: 2 } },
  { rate: 13.5, cap: 300, pool: { bug: 5, tank: 4, charger: 2, gunner: 3, shielder: 2, medic: 2, kami: 3 } },
  { rate: 11, cap: 270, pool: { bug: 4, tank: 4, gunner: 2, kami: 3 } },
  { rate: 16, cap: 340, pool: { bug: 3, tank: 4, charger: 2, blinker: 3, gunner: 2, shielder: 2, medic: 1 } },
  { rate: 18, cap: 370, pool: { bug: 3, tank: 4, eater: 2, blinker: 3, gunner: 2, splitter: 3, medic: 1 } },
  { rate: 20, cap: 400, pool: { tank: 4, eater: 2, blinker: 2, spitter: 3, charger: 3, shielder: 2, kami: 3 } },
  { rate: 22, cap: 430, pool: { bug: 3, tank: 4, spitter: 3, blinker: 3, gunner: 3, medic: 2, splitter: 2 } },
  { rate: 18, cap: 400, pool: { bug: 4, tank: 4, kami: 4, gunner: 2 } },
  { rate: 26, cap: 460, pool: { tank: 5, charger: 3, spitter: 3, blinker: 3, shielder: 3, medic: 2, eater: 1 } },
  { rate: 29, cap: 480, pool: { tank: 5, charger: 3, gunner: 3, spitter: 3, splitter: 3, kami: 3, shielder: 2 } },
  { rate: 32, cap: 500, pool: { tank: 5, charger: 3, blinker: 3, spitter: 3, eater: 2, medic: 2, shielder: 3 } },
  { rate: 36, cap: 520, pool: { tank: 6, charger: 3, gunner: 3, blinker: 3, spitter: 3, kami: 4, splitter: 2 } },
];
const ENDLESS_POOL = { tank: 6, charger: 3, gunner: 3, blinker: 3, spitter: 3, kami: 4, splitter: 3, shielder: 3, medic: 2, eater: 2, bug: 2 };
const ELITE_TIMES = [95, 175, 250, 345, 420, 500, 560, 650, 730, 800, 860, 950, 1020, 1080, 1140];
// свойства элиты: каждое меняет и облик машины, и её поведение
const ELITE_AFFIX = {
  armored: { name: 'Бронированный', d: 'Бронеплиты гасят 45% урона, пока их не сбить' },
  overclock: { name: 'Разогнанный', d: 'Быстрее на 55%, тянет за собой раскалённый след' },
  brood: { name: 'Матка', d: 'Раз в 5 секунд выпускает выводок' },
  volatile: { name: 'Нестабильный', d: 'После гибели взрывается — отойдите' },
};
const ELITE_ARMOR_AT = 0.55; // броня держится, пока прочность выше этой доли
const EVENTS = [
  { t: 215, kind: 'ring' }, { t: 395, kind: 'rush' }, { t: 515, kind: 'ring' }, { t: 690, kind: 'rush' },
  { t: 815, kind: 'ring' }, { t: 990, kind: 'rush' }, { t: 1110, kind: 'ring' }, { t: 1160, kind: 'rush' },
];

/* ---------- Роботы ---------- */
const ROBOTS = [
  { id: 'iskra', name: 'ИСКРА-7', role: 'Универсал', weapon: 'blaster', mass: 412,
    desc: 'Сбалансированный боевой прототип. Быстрее учится: +10% опыта.',
    st: { growth: 0.1 }, pal: { m: '#9aa8bb', a: '#3fe0ff', e: '#a8f8ff' }, build: 1, startPart: 'head',
    od: { id: 'boost', name: 'Форсаж', d: 'чистый овердрайв: длится на 2 с дольше' } },
  { id: 'razryad', name: 'РАЗРЯД', role: 'Энергетик', weapon: 'arc', mass: 356,
    desc: 'Перезарядка −10%, урон молний +15%. Хрупкий корпус: −20 прочности.',
    st: { cdr: 0.1, maxHp: -20, arcDmg: 0.15 }, pal: { m: '#8e96c8', a: '#b38bff', e: '#efe4ff' }, build: 0.95, startPart: 'back',
    od: { id: 'storm', name: 'Гроза', d: 'каждые 0,25 с молния с неба бьёт машину на экране и перескакивает дальше' },
    unlock: { ach: 'form3', text: 'Достигните Формы III' } },
  { id: 'goliath', name: 'ГОЛИАФ', role: 'Танк', weapon: 'shock', mass: 780,
    desc: 'Прочность +50, броня +2. Медленнее на 12%.',
    st: { maxHp: 50, armor: 2, speed: -0.12 }, pal: { m: '#a59a88', a: '#ffb43d', e: '#ffe5ad' }, build: 1.12, startPart: 'core',
    od: { id: 'quake', name: 'Землетрясение', d: 'каждые 0,7 с удар по земле: стена-кольцо оглушает и отбрасывает Рой' },
    unlock: { ach: 'survive10', text: 'Продержитесь 10 минут' } },
  { id: 'osa', name: 'ОСА', role: 'Разведчик', weapon: 'drones', mass: 288,
    desc: 'Скорость +18%, радиус сбора +30%. Прочность −20.',
    st: { speed: 0.18, magnet: 0.3, maxHp: -20 }, pal: { m: '#d2bd57', a: '#ffef5c', e: '#ff6b6b', md: '#3a3320' }, build: 0.9, startPart: 'legs',
    od: { id: 'swarm', name: 'Осиный рой', d: 'восемь боевых дронов облетают корпус и таранят машины' },
    unlock: { ach: 'boss1', text: 'Уничтожьте «Молота»' } },
  { id: 'pepel', name: 'ПЕПЕЛ', role: 'Поджигатель', weapon: 'flamer', mass: 455,
    desc: 'Площадь +15%, урон горения +50%.',
    st: { area: 0.15, burn: 0.5 }, pal: { m: '#7f726d', a: '#ff6a2b', e: '#ffd6a8' }, build: 1, startPart: 'arms',
    od: { id: 'firestorm', name: 'Огненный смерч', d: 'вокруг корпуса кружит кольцо огня и поджигает всё на пути' },
    unlock: { ach: 'evolve1', text: 'Эволюционируйте любое орудие' } },
  { id: 'omega', name: 'ОМЕГА', role: 'Совершенство', weapon: null, mass: 500,
    desc: 'Все модули стартуют с МК-I. Случайное орудие. +10% урона и опыта.',
    st: { might: 0.1, growth: 0.1 }, pal: { m: '#e4e8f4', a: '#ff4f9a', e: '#ffffff' }, build: 1.02, startParts: 1,
    od: { id: 'avatar', name: 'Аватар', d: 'время для Роя замедляется вдвое' },
    unlock: { ach: 'win', text: 'Уничтожьте Ядро Роя' } },
];

/* ---------- Сектора ---------- */
const SECTORS = [
  { id: 'rust', name: 'Ржавые пустоши', code: 'С-1', hp: 1, spd: 1, rate: 1, dmg: 1, scrap: 1,
    desc: 'Окраины. Свалки, ржавчина и первые колонии Роя.',
    pal: { ground: '#060c18', ground2: '#091428', grid: '#0d203b', gridMajor: '#173a63', cross: '#2f6aa8', note: '#2b5f96', deco: '#1d4f84', deco2: '#2a6aa8', a: '#ff8a3d',
      enemy: '#ff3d55', enemyD: '#2a0610', enemyL: '#ff9aa8', eye: '#ffd23f', fog: '#03060d' } },
  { id: 'neon', name: 'Неоновый мегаполис', code: 'С-2', hp: 1.8, spd: 1.06, rate: 1.15, dmg: 1.2, scrap: 1.6,
    desc: 'Мёртвый город, где Рой захватил рекламные экраны.',
    pal: { ground: '#0a0716', ground2: '#100b24', grid: '#1a1238', gridMajor: '#2b1e5c', cross: '#7458e0', note: '#6a52c8', deco: '#3c2c80', deco2: '#9a3fd0', a: '#ff3fa4',
      enemy: '#ff3fd2', enemyD: '#24082a', enemyL: '#ffa6ee', eye: '#46e3ff', fog: '#040209' },
    unlock: { ach: 'boss2', text: 'Уничтожьте «Улей» в Ржавых пустошах' } },
  { id: 'hive', name: 'Сердце Роя', code: 'С-3', hp: 2.7, spd: 1.12, rate: 1.3, dmg: 1.45, scrap: 2.4,
    desc: 'Живой металл. Здесь Рой рождается.',
    pal: { ground: '#10040a', ground2: '#170610', grid: '#2a0a18', gridMajor: '#47122b', cross: '#b0304a', note: '#9a2a44', deco: '#5e1a33', deco2: '#a8273f', a: '#ff3d5a',
      enemy: '#ff7a2a', enemyD: '#2a0c04', enemyL: '#ffc08a', eye: '#ffe14d', fog: '#060104' },
    unlock: { ach: 'neon3', text: 'Уничтожьте «Змея» в Неоновом мегаполисе' } },
  { id: 'cryo', name: 'Криобаза', code: 'С-4', hp: 2.2, spd: 1.04, rate: 1.2, dmg: 1.3, scrap: 2,
    desc: 'Заброшенная полярная станция: лёд, торосы и холодные реакторы. Рой замёрз — но не весь.',
    pal: { ground: '#04101a', ground2: '#06182a', grid: '#0b2a40', gridMajor: '#14466a', cross: '#4fb6e8', note: '#3f8fbd', deco: '#1a5a80', deco2: '#3aa0d0', a: '#8fe8ff',
      enemy: '#ff2e4d', enemyD: '#2a0610', enemyL: '#ffa0b0', eye: '#8fe8ff', fog: '#020810' },
    unlock: { ach: 'survive5', text: 'Продержитесь 5 минут' } },
  { id: 'orbit', name: 'Орбитальная станция', code: 'С-5', hp: 3, spd: 1.14, rate: 1.35, dmg: 1.5, scrap: 2.8,
    desc: 'Станция на орбите: палубы, шлюзы и пустота за бортом. Рой пришёл с кометой.',
    pal: { ground: '#05060c', ground2: '#0a0c16', grid: '#161a2c', gridMajor: '#262e4c', cross: '#8a96ff', note: '#5f6ad0', deco: '#2a3060', deco2: '#6a74e0', a: '#ffd36b',
      enemy: '#ff3d7a', enemyD: '#2a0614', enemyL: '#ffa0c0', eye: '#7dffcf', fog: '#020208' },
    unlock: { ach: 'boss1', text: 'Уничтожьте «Молота»' } },
];

/* ---------- Мастерская (постоянные улучшения) ---------- */
const UPGRADES = [
  { id: 'hp', name: 'Бронепластины', d: '+10 прочности', max: 5, base: 40, st: { maxHp: 10 } },
  { id: 'might', name: 'Калибровка орудий', d: '+5% урона', max: 5, base: 60, st: { might: 0.05 } },
  { id: 'armor', name: 'Композитная броня', d: '+1 броня', max: 3, base: 120, st: { armor: 1 } },
  { id: 'regen', name: 'Ремонтные наниты', d: '+0,2 регенерации/с', max: 3, base: 90, st: { regen: 0.2 } },
  { id: 'speed', name: 'Смазка приводов', d: '+4% скорости', max: 3, base: 70, st: { speed: 0.04 } },
  { id: 'cdr', name: 'Система охлаждения', d: '−3% перезарядки', max: 3, base: 120, st: { cdr: 0.03 } },
  { id: 'area', name: 'Фокусирующие линзы', d: '+5% площади атак', max: 3, base: 80, st: { area: 0.05 } },
  { id: 'dur', name: 'Стабилизатор полей', d: '+5% длительности', max: 3, base: 70, st: { duration: 0.05 } },
  { id: 'magnet', name: 'Магнитный контур', d: '+15% радиуса сбора', max: 3, base: 40, st: { magnet: 0.15 } },
  { id: 'growth', name: 'Нейросеть', d: '+5% опыта', max: 5, base: 70, st: { growth: 0.05 } },
  { id: 'luck', name: 'Вероятностный модуль', d: '+8% удачи', max: 3, base: 80, st: { luck: 0.08 } },
  { id: 'greed', name: 'Сборщик лома', d: '+10% лома', max: 5, base: 50, st: { greed: 0.1 } },
  { id: 'crit', name: 'Прицельный контур', d: '+2% шанс крита', max: 3, base: 90, st: { crit: 0.02 } },
  { id: 'od', name: 'Предзарядка', d: 'Старт с +25% овердрайва, заряд +5%', max: 2, base: 150, st: { odStart: 25, odRate: 0.05 } },
  { id: 'reroll', name: 'Перераспределитель', d: '+1 пересчёт за забег', max: 5, base: 60, st: { reroll: 1 } },
  { id: 'banish', name: 'Блокиратор', d: '+1 блокировка за забег', max: 3, base: 80, st: { banish: 1 } },
  { id: 'revive', name: 'Резервная копия', d: '+1 воскрешение', max: 2, base: 600, st: { revive: 1 } },
];
const upgradeCost = (u, r) => Math.round(u.base * (1 + r) * (1 + 0.4 * r));

/* ---------- Достижения ---------- */
const ACHIEVEMENTS = [
  { id: 'first', name: 'Пробуждение', d: 'Завершите первый забег', r: 50 },
  { id: 'survive5', name: 'Боевое крещение', d: 'Продержитесь 5 минут', r: 80 },
  { id: 'survive10', name: 'Ветеран', d: 'Продержитесь 10 минут', r: 150, unlock: 'ГОЛИАФ' },
  { id: 'boss1', name: 'Молотобоец', d: 'Уничтожьте «Молота»', r: 120, unlock: 'ОСА' },
  { id: 'boss2', name: 'Разоритель ульев', d: 'Уничтожьте «Улей» в Ржавых пустошах', r: 200, unlock: 'Неоновый мегаполис' },
  { id: 'boss3', name: 'Змееборец', d: 'Уничтожьте «Змея»', r: 300 },
  { id: 'win', name: 'Протокол завершён', d: 'Уничтожьте Ядро Роя', r: 600, unlock: 'ОМЕГА и уровни угрозы' },
  { id: 'neon3', name: 'Неоновая охота', d: 'Уничтожьте «Змея» в Неоновом мегаполисе', r: 400, unlock: 'Сердце Роя' },
  { id: 'winHive', name: 'Сердце тьмы', d: 'Победите в Сердце Роя', r: 1000 },
  { id: 'evolve1', name: 'Эволюция', d: 'Эволюционируйте любое орудие', r: 120, unlock: 'ПЕПЕЛ' },
  { id: 'evolve5', name: 'Коллекционер', d: 'Откройте 5 разных эволюций', r: 400 },
  { id: 'evolveAll', name: 'Полный арсенал', d: 'Откройте все 15 эволюций', r: 1500 },
  { id: 'form3', name: 'Штурмовик', d: 'Достигните Формы III', r: 100, unlock: 'РАЗРЯД' },
  { id: 'formO', name: 'Омега-точка', d: 'Достигните Ω-формы', r: 500 },
  { id: 'branches', name: 'Конструктор', d: 'Установите все 10 веток модулей', r: 400 },
  { id: 'kills1k', name: 'Истребитель', d: '1000 уничтожений за забег', r: 150 },
  { id: 'kills10k', name: 'Мясорубка', d: '10 000 уничтожений за всё время', r: 300 },
  { id: 'lvl50', name: 'Сверхразум', d: 'Достигните 50 уровня', r: 250 },
  { id: 'od10', name: 'Перегрев', d: '10 овердрайвов за один забег', r: 150 },
  { id: 'threat5', name: 'Угроза V', d: 'Победите на угрозе 5 или выше', r: 800 },
  { id: 'endless30', name: 'Бессмертный', d: 'Продержитесь 30 минут', r: 1000 },
  { id: 'relay3', name: 'Связист', d: 'Захватите 3 ретранслятора Роя за забег', r: 150 },
  { id: 'rx4', name: 'Химик', d: 'Вызовите 4 разные реакции за один забег', r: 150 },
  { id: 'link3', name: 'Оркестр', d: 'Соберите 3 связки орудий в одном забеге', r: 250 },
];

/* ---------- Заполнители, когда всё прокачано ---------- */
const FILLERS = [
  { id: 'f_heal', name: 'Полевой ремонт', d: 'Восстановить 35% прочности', color: '#5dff9b' },
  { id: 'f_scrap', name: 'Утилизация', d: '+30 лома', color: '#ffb43d' },
  { id: 'f_might', name: 'Сверхразгон: урон', d: 'Урон +4% (накапливается)', color: '#ff8a3d', st: { might: 0.04 } },
  { id: 'f_cdr', name: 'Сверхразгон: такт', d: 'Перезарядка −2% (накапливается)', color: '#3fe0ff', st: { cdr: 0.02 } },
  { id: 'f_hp', name: 'Сверхразгон: корпус', d: 'Прочность +12 (накапливается)', color: '#ff5d73', st: { maxHp: 12 } },
  { id: 'f_area', name: 'Сверхразгон: поле', d: 'Площадь +3% (накапливается)', color: '#b38bff', st: { area: 0.03 } },
];

const STATUSES = [
  { id: 'burn', name: 'Горение', color: '#ff7a2e', d: 'Урон каждые 0,5 с. Источники: огнемёт, клинок, пламя дюз.' },
  { id: 'chill', name: 'Холод', color: '#8fe8ff', d: 'Замедляет. Накопленный холод замораживает цель.' },
  { id: 'shock', name: 'Шок', color: '#c9a6ff', d: 'Короткое оглушение. Боссы невосприимчивы.' },
  { id: 'corrode', name: 'Коррозия', color: '#8dff6a', d: 'Цель получает больше урона от всех источников.' },
];
/* ---------- Комбинации ----------
   Реакции: два статуса на одной машине дают усиленный эффект (работают и на боссах — без оглушения).
   Связки: два орудия на одном корпусе меняют поведение друг друга; эволюции связку сохраняют. */
const REACTIONS = {
  thermo: { name: 'Термошок', a: 'burn', b: 'chill', col: '#ffd36b', d: 'Подожгите замороженную машину (боссу хватит холода) — взрыв льда и пламени: огромный урон по цели и осколки вокруг.' },
  plasma: { name: 'Плазменный пробой', a: 'burn', b: 'shock', col: '#ff9a5a', d: 'Шок по горящей машине: пламя прыгает по молниям на четыре соседние и поджигает их.' },
  thermite: { name: 'Термит', a: 'burn', b: 'corrode', col: '#ffe08a', d: 'Огонь по разъеденной броне: термитная вспышка и лужа расплава, которая жжёт и разъедает.' },
  super: { name: 'Сверхпроводник', a: 'chill', b: 'shock', col: '#9ff0ff', d: 'Шок по охлаждённой машине: ледяная молния бежит по пяти целям и быстро их замораживает.' },
  brittle: { name: 'Хрупкость', a: 'chill', b: 'corrode', col: '#c8ffd8', d: 'Разъеденная машина замерзает и раскалывается: тяжёлый урон и ледяные осколки вокруг.' },
  short: { name: 'Короткое замыкание', a: 'shock', b: 'corrode', col: '#c9a6ff', d: 'Шок по разъеденной машине: электрический взрыв по площади.' },
};
const COMBOS = Object.values(REACTIONS);
const LINKS = [
  { id: 'meteor', a: 'magnet', b: 'flamer', name: 'Метеоры', col: '#ff7a2e', d: 'Брошенные электромагнитом машины пылают на лету и взрываются огненным шаром.' },
  { id: 'thunder', a: 'glaive', b: 'arc', name: 'Громовой бумеранг', col: '#c9a6ff', d: 'Каждый удар глефы бьёт молнией в соседнюю машину. Молния оглушает — и запускает реакции.' },
  { id: 'twin', a: 'blade', b: 'glaive', name: 'Парные клинки', col: '#62f0ff', d: 'Каждый взмах плазменного клинка запускает вперёд малую световую глефу.' },
  { id: 'focus', a: 'gravity', b: 'missiles', name: 'Фокус', col: '#b78bff', d: 'Ракеты сворачивают в сингулярность; взрыв в её поле вдвое сильнее и шире.' },
  { id: 'icebreak', a: 'rail', b: 'cryo', name: 'Ледокол', col: '#bff6ff', d: 'Рельса бьёт холодом и ищет охлаждённых: по ним урон ×2,5, по замороженным ×4 — цель разлетается ледяными осколками.' },
  { id: 'support', a: 'blaster', b: 'drones', name: 'Огневая поддержка', col: '#7dffb0', d: 'Дроны повторяют каждый выстрел бластера по той же цели.' },
  { id: 'detonator', a: 'shock', b: 'mines', name: 'Детонатор', col: '#ffe066', d: 'Ударная волна подрывает мины, которых коснулась, — взрыв в полтора раза мощнее.' },
  { id: 'rustsaw', a: 'saw', b: 'nanites', name: 'Ржавые пилы', col: '#b8ff6a', d: 'Удар пилы выпускает облачко нанитов; разъеденные машины пила режет на 60% сильнее.' },
];

const TIPS = [
  'Модули корпуса — это и есть трансформация. На МК-III каждый модуль ветвится — выбирайте под свою сборку.',
  'Эволюция: орудие 8-го уровня + нужный модуль МК-III, затем откройте контейнер с элитного врага или босса.',
  'Овердрайв копится от уничтожений. Полная шкала — нажмите E или кнопку справа.',
  'Рывок (пробел) даёт неуязвимость на долю секунды. Им можно пролететь сквозь толпу.',
  'Пожиратели едят кристаллы опыта. Убейте его — и он вернёт всё с процентами.',
  'Ремонтники и щитоносцы делают толпу живучей. Убирайте их первыми.',
  'Реакции: два статуса на одной машине дают усиленный эффект — огонь + холод, шок + коррозия и ещё четыре пары.',
  'Связки: некоторые пары орудий меняют поведение друг друга. Карточка с меткой «СВЯЗКА» достроит пару.',
  'Контейнеры снабжения на карте прячут ремкомплекты, магниты и ЭМИ-бомбы.',
  'Каждые 4, 9, 15 и 22 ранга модулей робот достигает новой формы — и становится сильнее.',
];
