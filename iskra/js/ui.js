'use strict';
/* ===== Интерфейс: меню, ангар, мастерская, справочник, HUD, карточки улучшений ===== */

const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = n => (n < 10 ? '0' : '') + n;
function wcode(id) { return 'ОР-' + pad2(WEAPON_ORDER.indexOf(id) + 1); }
function pips(n, max, cls) { let s = '<span class="pips ' + (cls || '') + '">'; for (let i = 0; i < max; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>'; return s + '</span>'; }
function fmtPct(v) { return (v >= 0 ? '+' : '−') + Math.round(Math.abs(v) * 100) + '%'; }

/* ===== Дерево эволюций: модуль → орудия → эволюции (в справочнике — что открыто, в паузе — живой статус забега) ===== */
function evoTreeHTML(live) {
  // в забеге выше — модули, на которых уже стоят орудия
  const owned = pid => P.weapons.filter(w => WEAPONS[baseOf(w)].part === pid).length;
  const order = live ? PART_ORDER.slice().sort((a, b) => owned(b) - owned(a) || PART_ORDER.indexOf(a) - PART_ORDER.indexOf(b)) : PART_ORDER;
  const mods = order.map(pid => {
    const Pd = PARTS[pid], rank = live ? P.parts[pid].rank : 0, br = live ? P.parts[pid].branch : null;
    const pips = [1, 2, 3, 4, 5].map(i => `<i class="${i <= rank ? 'on' : ''}${i === EVO_RANK ? ' req' : ''}"></i>`).join('');
    const rows = WEAPON_ORDER.filter(id => WEAPONS[id].part === pid).map(id => {
      const Wd = WEAPONS[id], E = EVOS[Wd.evo], known = !!SAVE.discovered.evolutions[Wd.evo];
      let cls = '', wsub = '', esub = '', lv = 0;
      if (live) {
        const w = P.weapons.find(x => baseOf(x) === id);
        if (!w) { cls = 'off'; wsub = 'не установлено'; esub = 'ур. 8 + ' + Pd.name + ' МК-' + ROMAN[EVO_RANK]; }
        else if (w.evo) { cls = 'done'; wsub = 'эволюционировало'; esub = 'активна'; lv = 8; }
        else {
          lv = w.lvl;
          wsub = 'ур. ' + w.lvl + '/8';
          if (w.lvl < 8) { cls = 'own'; esub = 'нужен ур. 8' + (rank < EVO_RANK ? ' и МК-' + ROMAN[EVO_RANK] : ''); }
          else if (rank < EVO_RANK) { cls = 'own need'; esub = 'нужен ' + Pd.name.toLowerCase() + ' МК-' + ROMAN[EVO_RANK]; }
          else { cls = 'own ready'; esub = 'готово: откройте контейнер'; }
        }
      } else { cls = known ? 'done' : 'off'; wsub = Wd.desc.split('.')[0]; esub = known ? E.desc.split('.')[0] : 'ур. 8 + МК-' + ROMAN[EVO_RANK] + ' → контейнер'; }
      const showEvo = known || (live && cls.includes('done'));
      return `<div class="erow ${cls}"><div class="ew"><img src="${SPR.icons[id]}" alt=""><div><b>${esc(Wd.name)}</b><span>${esc(wsub)}</span>${live && lv && lv < 8 ? `<em class="lvbar"><i style="width:${lv / 8 * 100}%"></i></em>` : ''}</div></div>
        <span class="arr"></span>
        <div class="ee ${showEvo ? '' : 'unk'}"><img src="${SPR.icons[Wd.evo]}" alt=""><div><b>${showEvo ? esc(E.name) : '???'}</b><span>${esc(esub)}</span></div></div></div>`;
    }).join('');
    return `<div class="emod" style="--c:${Pd.color}"><div class="emod-h"><img src="${SPR.icons['part_' + pid]}" alt=""><div><b>${esc(Pd.name)}${live ? ' МК-' + ROMAN[rank] : ''}</b><span class="mono">${esc(Pd.code)} · ${esc(Pd.role)}${br ? ' · ' + esc(Pd.branches[br].name) : ''}</span></div><span class="pips" title="МК-${ROMAN[EVO_RANK]} открывает эволюции">${pips}</span></div><div class="erows">${rows}</div></div>`;
  }).join('');
  return `<p class="etree-lead">Эволюция = орудие ур. 8 + его модуль МК-${ROMAN[EVO_RANK]} (◆ с рамкой) → контейнер элиты или босса. ${live ? 'Зелёным — готово к эволюции.' : 'Открыто ' + Object.keys(SAVE.discovered.evolutions || {}).length + ' из ' + Object.keys(EVOS).length + '.'}</p><div class="etree">${mods}</div>`;
}

/* ===== Справочник: таблица реакций и связки орудий ===== */
function comboHTML() {
  const ST = ['burn', 'chill', 'shock', 'corrode'], SN = Object.fromEntries(STATUSES.map(x => [x.id, x])), rx = (a, b) => Object.keys(REACTIONS).find(k => (REACTIONS[k].a === a && REACTIONS[k].b === b) || (REACTIONS[k].a === b && REACTIONS[k].b === a));
  const seenRx = SAVE.discovered.reactions || {}, seenL = SAVE.discovered.links || {};
  const head = '<tr><th></th>' + ST.map(s => `<th style="color:${SN[s].color}">${esc(SN[s].name)}</th>`).join('') + '</tr>';
  const rows = ST.map((a, i) => `<tr><th style="color:${SN[a].color}">${esc(SN[a].name)}</th>` + ST.map((b, j) => {
    if (i === j) return '<td class="x">—</td>';
    const k = rx(a, b), R = REACTIONS[k];
    return `<td style="--c:${R.col}" class="${seenRx[k] ? 'seen' : ''}">${esc(R.name)}</td>`;
  }).join('') + '</tr>').join('');
  const rxList = Object.keys(REACTIONS).map(k => { const R = REACTIONS[k]; return `<div class="rk" style="grid-template-columns:150px 1fr"><b style="color:${R.col}">${seenRx[k] ? '✓ ' : ''}${esc(R.name)}</b><span>${esc(R.d)}</span></div>`; }).join('');
  const links = LINKS.map(L => `<div class="lcard ${seenL[L.id] ? 'seen' : ''}" style="--c:${L.col}">
      <div class="lpair"><img src="${SPR.icons[L.a]}" alt=""><span>+</span><img src="${SPR.icons[L.b]}" alt=""></div>
      <div><div class="nm">${seenL[L.id] ? '✓ ' : ''}${esc(L.name)}</div><div class="mono lw">${esc(WEAPONS[L.a].name)} + ${esc(WEAPONS[L.b].name)}</div><div class="ds">${esc(L.d)}</div></div></div>`).join('');
  return `<p class="etree-lead">Реакция — два статуса на одной машине: срабатывает сама, на боссах тоже (их не оглушает, но реакцию шок даёт). Связка — два орудия на корпусе меняют поведение друг друга; эволюции связку сохраняют, сила растёт с уровнем младшего орудия пары.</p>
    <div class="tree"><div class="tnode"><div class="h2">Таблица реакций</div><div class="rxwrap"><table class="rxgrid">${head}${rows}</table></div>${rxList}</div></div>
    <div class="h2" style="margin:18px 0 10px">Связки орудий · ${Object.keys(seenL).length} из ${LINKS.length}</div><div class="lgrid">${links}</div>`;
}

const UI = {
  modal: null, screen: null, previews: [], hud: {}, sig: '', lastSec: -1, toastQ: [], toastT: 0, sel: { robot: 'iskra', sector: 'rust', threat: 0 },
  luChoices: null, banishMode: false, codexTab: 'weapons', pauseTab: 'build', confirmReset: false, confirmQuit: false, chestRes: null, chestTimer: null, hintT: 0,

  init() {
    this.root = $('#ui');
    this.root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      AUDIO.init();
      const fn = this.act[b.dataset.act];
      if (fn) { AUDIO.sfx('ui'); fn.call(this, b, e); }
    });
    this.root.addEventListener('input', e => { const t = e.target; if (t.dataset.set) this.setVal(t.dataset.set, parseFloat(t.value)); });
    this.buildHud();
    const L = SAVE.last || {};
    this.sel.robot = L.robot || 'iskra'; this.sel.sector = L.sector || 'rust'; this.sel.threat = L.threat || 0;
    if (!ROBOTS.find(r => r.id === this.sel.robot && robotUnlocked(r))) this.sel.robot = 'iskra';
    if (!SECTORS.find(s => s.id === this.sel.sector && sectorUnlocked(s))) this.sel.sector = 'rust';
  },

  /* ---------- общие ---------- */
  open(id) {
    this.previews = [];
    this.screen = id;
    this.modal = null;
    this.root.innerHTML = this.render[id].call(this);
    this.afterRender(id);
    this.focusFirst();
  },
  openModal(id, html) {
    this.modal = id;
    this.root.innerHTML = html;
    this.afterRender(id);
    this.focusFirst();
  },
  closeModal() { this.modal = null; this.root.innerHTML = ''; this.previews = []; },
  afterRender(id) {
    for (const cv of this.root.querySelectorAll('canvas[data-robot]')) {
      const r = ROBOTS.find(x => x.id === cv.dataset.robot);
      this.previews.push({ cv, look: makeLook(r, startPartsFor(r), 0, 0), anim: true, zoom: 1.05 });
    }
  },
  focusables() {
    const scope = this.root;
    return Array.from(scope.querySelectorAll('button:not([disabled]), input')).filter(b => b.offsetParent !== null);
  },
  focusFirst() {
    if (INPUT.touchSeen) return;
    const f = this.root.querySelector('[data-autofocus]') || this.root.querySelector('.btn.primary') || this.focusables()[0];
    if (f) setTimeout(() => { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }, 30);
  },
  nav(dir) {
    const list = this.focusables();
    if (!list.length) return;
    let i = list.indexOf(document.activeElement);
    if (i < 0) { list[0].focus(); return; }
    const cur = list[i].getBoundingClientRect(), cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
    let best = null, bd = 1e9;
    for (const el of list) {
      if (el === list[i]) continue;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
      const ok = dir === 'left' ? dx < -4 : dir === 'right' ? dx > 4 : dir === 'up' ? dy < -4 : dy > 4;
      if (!ok) continue;
      const d = (dir === 'left' || dir === 'right') ? Math.abs(dx) + Math.abs(dy) * 2.5 : Math.abs(dy) + Math.abs(dx) * 2.5;
      if (d < bd) { bd = d; best = el; }
    }
    if (!best) best = list[(i + (dir === 'up' || dir === 'left' ? -1 : 1) + list.length) % list.length];
    best.focus();
    AUDIO.sfx('card');
  },
  activate() { const a = document.activeElement; if (a && this.root.contains(a)) a.click(); },
  back() {
    if (this.modal === 'pause') return this.act.resume.call(this);
    if (this.modal) return;
    if (this.screen && this.screen !== 'title' && G.state !== 'play') this.open('title');
  },
  key(e) {
    const k = e.code;
    if (G.state === 'play' && !this.modal) return false;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') { this.nav(k.replace('Arrow', '').toLowerCase()); return true; }
    if (k === 'Escape' || k === 'KeyP') {
      if (this.modal === 'pause') { this.act.resume.call(this); return true; }
      if (!this.modal && G.state !== 'play') { this.back(); return true; }
      return false;
    }
    if (this.modal === 'levelup') {
      const n = parseInt(k.replace('Digit', '').replace('Numpad', ''), 10);
      if (n >= 1 && n <= 4) { const b = this.root.querySelector('.card[data-i="' + (n - 1) + '"]'); if (b) b.click(); return true; }
      if (k === 'KeyR') { const b = this.root.querySelector('[data-act="reroll"]'); if (b && !b.disabled) b.click(); return true; }
      if (k === 'KeyB') { const b = this.root.querySelector('[data-act="banish"]'); if (b && !b.disabled) b.click(); return true; }
    }
    if (this.modal === 'branch') {
      if (k === 'Digit1' || k === 'KeyA') { const b = this.root.querySelector('.bcard[data-b="A"]'); if (b) b.click(); return true; }
      if (k === 'Digit2') { const b = this.root.querySelector('.bcard[data-b="B"]'); if (b) b.click(); return true; }
    }
    if (this.modal === 'chest' && (k === 'Space' || k === 'Enter') && this.chestTimer) { this.revealChest(); return true; }
    return false;
  },
  touchMode(on) { document.body.classList.toggle('touch', on); const t = $('#touchbtns'); if (t) t.hidden = !on; },

  /* ---------- экраны меню ---------- */
  render: {
    title() {
      const best = Math.max(0, ...Object.values(SAVE.best).map(b => b.time || 0));
      const ach = ACHIEVEMENTS.filter(a => SAVE.ach[a.id]).length;
      const evo = Object.keys(SAVE.discovered.evolutions || {}).length;
      const bought = UPGRADES.reduce((s, u) => s + (SAVE.upg[u.id] || 0), 0), maxU = UPGRADES.reduce((s, u) => s + u.max, 0);
      const r = ROBOTS[MENU.robotIdx % ROBOTS.length];
      return `<section class="screen menu" id="scr-title"><div class="title-grid"><div class="title-block">
        <h1 class="logo"><span class="pre">ПРОТОКОЛ</span><span class="name">ИСКРА</span><span class="sub">трансформируйся · выживи · сотри Рой</span></h1>
        <p class="lead">Последний боевой прототип против бесконечного Роя машин. Каждый уровень — новое орудие или новый модуль корпуса, и робот перестраивается прямо посреди боя.</p>
        <div class="menu-list">
          <button class="btn primary" data-act="open" data-scr="hangar" data-autofocus>В бой <span class="n">ангар</span></button>
          <button class="btn" data-act="open" data-scr="workshop">Мастерская <span class="n">${bought}/${maxU}</span></button>
          <button class="btn" data-act="open" data-scr="codex">Справочник <span class="n">эволюций ${evo}/${Object.keys(EVOS).length}</span></button>
          <button class="btn" data-act="open" data-scr="ach">Достижения <span class="n">${ach}/${ACHIEVEMENTS.length}</span></button>
          <button class="btn" data-act="open" data-scr="settings">Настройки <span class="n">звук · графика</span></button>
        </div>
        <div class="row"><span class="scrap"><i></i>${fmtInt(SAVE.scrap)} лома</span>${best ? `<span class="chip">рекорд ${fmtTime(best)}</span>` : ''}</div>
        <div class="stampbox" aria-label="Паспорт изделия">
          <div>Изделие<b>${esc(r.name)}</b></div><div>Лит.<b>О${MENU.robotIdx % ROBOTS.length + 1}</b></div><div>Масса<b>${r.mass} кг</b></div><div>Масштаб<b>1:10</b></div>
          <div>Разраб.<b>КБ «Рассвет»</b></div><div>Т. контр.<b>ОТК</b></div><div>Лист<b>${MENU.robotIdx % ROBOTS.length + 1}</b></div><div>Листов<b>${ROBOTS.length}</b></div>
        </div>
      </div></div></section>`;
    },
    hangar() {
      const sel = ROBOTS.find(r => r.id === this.sel.robot) || ROBOTS[0];
      const robots = ROBOTS.map(r => {
        const un = robotUnlocked(r);
        return `<button class="rcard ${r.id === sel.id ? 'sel' : ''} ${un ? '' : 'locked'}" data-act="${un ? 'pickRobot' : 'noop'}" data-id="${r.id}" aria-label="${esc(r.name)}">
          <canvas width="250" height="200" data-robot="${r.id}"></canvas>
          ${un ? '' : `<span class="lock">🔒 ${esc(r.unlock.text)}</span>`}
          <span class="meta"><span class="nm">${esc(r.name)}</span><span class="rl">${esc(r.role)}</span></span></button>`;
      }).join('');
      const w = sel.weapon ? WEAPONS[sel.weapon] : null;
      const stats = [];
      for (const k in sel.st) {
        const v = sel.st[k];
        const names = { growth: 'Опыт', cdr: 'Перезарядка', maxHp: 'Прочность', arcDmg: 'Урон молний', armor: 'Броня', speed: 'Скорость', magnet: 'Радиус сбора', area: 'Площадь', burn: 'Урон горения', might: 'Урон' };
        let txt = k === 'maxHp' || k === 'armor' ? (v > 0 ? '+' : '−') + Math.abs(v) : k === 'cdr' ? '−' + Math.round(v * 100) + '%' : fmtPct(v);
        stats.push(`<span>${names[k] || k}</span><b>${txt}</b>`);
      }
      const sectors = SECTORS.map(s => {
        const un = sectorUnlocked(s), b = SAVE.best[s.id];
        return `<button class="scard ${s.id === this.sel.sector ? 'sel' : ''} ${un ? '' : 'locked'}" data-act="${un ? 'pickSector' : 'noop'}" data-id="${s.id}">
          <span class="sw" style="background:${s.pal.a}"></span>
          <span class="code">${s.code} · противник ×${s.hp} · лом ×${s.scrap}</span>
          <span class="nm">${esc(s.name)}</span>
          <span class="ds">${un ? esc(s.desc) : '🔒 ' + esc(s.unlock.text)}</span>
          ${b && b.time ? `<span class="best">рекорд ${fmtTime(b.time)} · ур. ${b.level}</span>` : ''}
        </button>`;
      }).join('');
      const maxThr = SAVE.threat[this.sel.sector] || 0;
      if (this.sel.threat > maxThr) this.sel.threat = maxThr;
      return `<section class="screen menu solid" id="scr-hangar"><div class="wrap">
        <div class="topbar"><button class="btn small" data-act="open" data-scr="title">← Назад</button><div><div class="eyebrow">Ангар</div><h2 class="h1">Выбор прототипа</h2></div><span class="spacer"></span><span class="scrap"><i></i>${fmtInt(SAVE.scrap)}</span><button class="btn primary" data-act="launch">Запуск ▸</button></div>
        <div class="hangar-grid">
          <div class="robots">${robots}</div>
          <div class="detail sheet"><div class="in" style="display:flex;flex-direction:column;gap:12px">
            <div class="eyebrow">Паспорт изделия · масса ${sel.mass} кг</div>
            <div class="h2">${esc(sel.name)} — ${esc(sel.role)}</div>
            <p class="lead" style="font-size:14px">${esc(sel.desc)}</p>
            <div class="row">${w ? `<img src="${SPR.icons[sel.weapon]}" width="40" height="40" alt=""><span><span class="eyebrow" style="display:block">Стартовое орудие</span><b>${esc(w.name)}</b></span>` : '<span class="eyebrow">Стартовое орудие: случайное</span>'}</div>
            ${sel.startPart ? `<div class="row prow"><img src="${SPR.icons['part_' + sel.startPart]}" width="40" height="40" alt=""><span><span class="eyebrow" style="display:block">Стартовый модуль</span><b>${esc(PARTS[sel.startPart].name)} МК-I · ${esc(PARTS[sel.startPart].ranks[0].name)}</b> <span class="mono" style="font-size:11px;color:var(--sub)">${esc(PARTS[sel.startPart].ranks[0].d)}</span></span></div>` : ''}
            ${sel.od ? `<div class="row prow"><span class="odchip">E</span><span><span class="eyebrow" style="display:block">Овердрайв прототипа</span><b>${esc(sel.od.name)}</b> <span class="mono" style="font-size:11px;color:var(--sub)">— ${esc(sel.od.d)}</span></span></div>` : ''}
            ${stats.length ? `<div class="statlist">${stats.join('')}</div>` : ''}
          </div></div>
        </div>
        <div class="eyebrow">Сектор высадки</div>
        <div class="sectors">${sectors}</div>
        <div class="row">
          ${maxThr > 0 ? `<div class="threat">Угроза <button class="btn small" data-act="thr" data-d="-1" ${this.sel.threat <= 0 ? 'disabled' : ''}>−</button><span class="v">${this.sel.threat}</span><button class="btn small" data-act="thr" data-d="1" ${this.sel.threat >= maxThr ? 'disabled' : ''}>+</button><span>враги сильнее, лома +${this.sel.threat * 15}%</span></div>` : '<span class="mono" style="color:var(--dim);font-size:12px">Уровни угрозы откроются после победы над Ядром Роя</span>'}
          <span class="spacer"></span>
          <button class="btn primary" data-act="launch" data-autofocus>Запуск · ${esc(sel.name)} ▸</button>
        </div>
      </div></section>`;
    },
    workshop() {
      const cards = UPGRADES.map(u => {
        const r = SAVE.upg[u.id] || 0, cost = upgradeCost(u, r), max = r >= u.max;
        return `<div class="ucard"><div class="row" style="justify-content:space-between"><span class="nm">${esc(u.name)}</span>${pips(r, u.max)}</div>
          <span class="ds">${esc(u.d)} за ранг</span>
          <button class="btn small ${max ? '' : 'gold'}" data-act="buy" data-id="${u.id}" ${max || SAVE.scrap < cost ? 'disabled' : ''}>${max ? 'Максимум' : 'Купить · ' + fmtInt(cost)}</button></div>`;
      }).join('');
      const spent = UPGRADES.reduce((s, u) => { let t = 0; for (let i = 0; i < (SAVE.upg[u.id] || 0); i++) t += upgradeCost(u, i); return s + t; }, 0);
      return `<section class="screen menu solid" id="scr-workshop"><div class="wrap">
        <div class="topbar"><button class="btn small" data-act="open" data-scr="title">← Назад</button><div><div class="eyebrow">Мастерская</div><h2 class="h1">Постоянные улучшения</h2></div><span class="spacer"></span><span class="scrap"><i></i>${fmtInt(SAVE.scrap)}</span></div>
        <p class="lead">Лом из забегов превращается в постоянные улучшения всех роботов. Цена растёт с каждым рангом.</p>
        <div class="upgrades">${cards}</div>
        <div class="row">${this.confirmReset ? `<div class="confirm"><span>Вернуть ${fmtInt(spent)} лома и сбросить все улучшения?</span><div class="row"><button class="btn small warn" data-act="refund">Да, вернуть</button><button class="btn small" data-act="refundNo">Отмена</button></div></div>` : `<button class="btn small" data-act="refundAsk" ${spent ? '' : 'disabled'}>Вернуть весь лом</button>`}</div>
      </div></section>`;
    },
    codex() {
      const tabs = [['weapons', 'Орудия'], ['tree', 'Эволюции'], ['combo', 'Связки'], ['parts', 'Модули'], ['enemies', 'Враги'], ['world', 'Локации'], ['mech', 'Механики']];
      let body = '';
      if (this.codexTab === 'weapons') {
        body = '<div class="clist">' + WEAPON_ORDER.map(id => {
          const w = WEAPONS[id], e = EVOS[w.evo], known = SAVE.discovered.evolutions[w.evo];
          return `<div class="crow"><img src="${SPR.icons[id]}" alt=""><div><div class="nm">${esc(w.name)} <span class="mono" style="font-size:11px;color:var(--dim)">${wcode(id)}</span></div><div class="ds">${esc(w.desc)}</div></div>
            <div class="evo"><img src="${SPR.icons[w.evo]}" alt="" style="${known ? '' : 'filter:brightness(0) opacity(.5)'}"><div><div class="nm" style="font-size:14px">${known ? esc(e.name) : '???'}</div><div class="req">ур. 8 + ${esc(PARTS[w.part].name)} МК-III → контейнер</div>${known ? `<div class="ds">${esc(e.desc)}</div>` : ''}</div></div></div>`;
        }).join('') + '</div>';
      } else if (this.codexTab === 'parts') {
        body = '<div class="tree">' + PART_ORDER.map(id => {
          const p = PARTS[id];
          const br = Object.keys(p.branches).map(b => { const B = p.branches[b]; return `<div style="border-color:${B.color}"><strong>${esc(B.name)}</strong><span class="mono" style="font-size:10px;color:${B.color};letter-spacing:.12em">${esc(B.tag.toUpperCase())}</span>${B.ranks.map((r, i) => `<span><b class="mono" style="color:var(--cyan);font-size:10px">МК-${ROMAN[i + 3]}</b> ${esc(r.name)}: ${esc(r.d)}</span>`).join('')}</div>`; }).join('');
          return `<div class="tnode"><div class="row"><img src="${SPR.icons['part_' + id]}" width="40" height="40" alt=""><div><div class="h2">${esc(p.name)}</div><div class="mono" style="font-size:11px;color:var(--sub)">${p.code} · ${esc(p.role)}</div></div></div>
            ${p.ranks.map((r, i) => `<div class="rk"><b>МК-${ROMAN[i + 1]}</b><span>${esc(r.name)}: ${esc(r.d)}</span></div>`).join('')}<div class="br">${br}</div></div>`;
        }).join('') + `<div class="tnode"><div class="h2">Формы корпуса</div>${FORMS.map(f => `<div class="rk"><b>${f.code}</b><span><b style="color:var(--ink)">${esc(f.name)}</b> — с ${f.at} рангов модулей${f.d ? '. ' + esc(f.d) : ''}</span></div>`).join('')}</div></div>`;
      } else if (this.codexTab === 'enemies') {
        body = '<div class="clist">' + ENEMY_CODEX.map(id => {
          const T = ENEMIES[id], known = SAVE.discovered.enemies[id];
          return `<div class="crow"><canvas width="104" height="104" data-enemy="${id}" style="${known ? '' : 'filter:brightness(0) opacity(.5)'}"></canvas><div><div class="nm">${known ? esc(T.name) : '???'}</div><div class="ds">${known ? esc(T.d) : 'Ещё не встречен'}</div></div><div class="ds mono" style="font-size:11px">${known ? 'прочность ' + T.hp + ' · скорость ' + T.spd : ''}</div></div>`;
        }).join('') + Object.keys(VARIANTS).map((v, k) => {
          // цветные варианты: цвет рёбер — поведение
          const V = VARIANTS[v], known = (SAVE.discovered.variants || {})[v], tid = VAR_TYPES[[1, 0, 1, 3, 4][k] || 0];
          return `<div class="crow"><canvas width="104" height="104" data-enemy="${tid}~${v}" style="${known ? '' : 'filter:brightness(0) opacity(.5)'}"></canvas><div><div class="nm" style="color:${known ? V.col : 'inherit'}">${known ? esc(V.name) + ' вариант' : '???'}</div><div class="ds">${known ? esc(V.d) : 'Цветной вариант машины Роя — ещё не встречен'}</div></div><div class="ds mono" style="font-size:11px">${known ? 'любые обычные машины · опыт ×1,6' : ''}</div></div>`;
        }).join('') + Object.keys(BOSSES).map(id => {
          const B = BOSSES[id], known = SAVE.discovered.enemies['boss_' + id];
          return `<div class="crow"><canvas width="104" height="104" data-boss="${id}" style="${known ? '' : 'filter:brightness(0) opacity(.5)'}"></canvas><div><div class="nm" style="color:${known ? B.color : 'inherit'}">${known ? esc(B.name) : '???'}</div><div class="ds">${known ? esc(B.title) + '. ' + esc(B.d) : 'Босс сектора'}</div></div><div class="ds mono" style="font-size:11px">${SECTORS.map(sc => { const b = bossSchedule(sc.id).find(x => x.id === id); return b ? sc.code + ' · ' + fmtTime(b.t) : ''; }).filter(Boolean).join('<br>')}</div></div>`;
        }).join('') + '</div>';
      } else if (this.codexTab === 'tree') {
        body = evoTreeHTML(false);
      } else if (this.codexTab === 'combo') {
        body = comboHTML();
      } else if (this.codexTab === 'world') {
        body = '<div class="tree">' + SECTORS.map(sc => {
          const Hz = HAZ[sc.id], open = !sc.unlock || SAVE.ach[sc.unlock.ach];
          return `<div class="tnode"><div class="row"><span class="secdot" style="background:${sc.pal.a}"></span><div><div class="h2">${esc(sc.name)}</div><div class="mono" style="font-size:11px;color:var(--sub)">${esc(sc.code)} · прочность Роя ×${String(sc.hp).replace('.', ',')} · лом ×${String(sc.scrap).replace('.', ',')}</div></div></div>
            <span class="ds" style="font-size:13px;color:var(--sub)">${esc(sc.desc)}${open ? '' : ' · ' + esc(sc.unlock.text)}</span>
            ${Hz ? `<div class="rk" style="grid-template-columns:92px 1fr"><b style="color:${Hz.col}">Опасность</b><span><b style="color:var(--ink)">${esc(Hz.name)}</b> — ${esc(Hz.d)}</span></div>` : ''}
            <div class="rk" style="grid-template-columns:92px 1fr"><b>Боссы</b><span>${bossSchedule(sc.id).map(b => fmtTime(b.t) + ' ' + esc(BOSSES[b.id].name)).join(' · ')}</span></div></div>`;
        }).join('') + `<div class="tnode"><div class="h2">Ретрансляторы Роя</div>
            <span class="ds" style="font-size:13px;color:var(--sub)">Каждые полторы минуты (кроме боя с боссом) Рой ставит мачту связи. Встаньте в круг и удерживайте ${String(RELAY.cap).replace('.', ',')} с — Рой будет стягиваться к мачте. Не захватили за ${RELAY.life} с — мачта отключится. Захват притягивает опыт вокруг мачты и даёт одну награду:</span>
            ${Object.values(RELAY_REW).map(r => `<div class="rk" style="grid-template-columns:150px 1fr"><b>${esc(r.name)}</b><span>${esc(r.d)}</span></div>`).join('')}</div></div>`;
      } else {
        body = `<div class="tree">
          <div class="tnode"><div class="h2">Статусы</div>${STATUSES.map(s => `<div class="rk"><b style="color:${s.color}">${esc(s.name)}</b><span>${esc(s.d)}</span></div>`).join('')}</div>
          <div class="tnode"><div class="h2">Реакции</div>${COMBOS.map(s => `<div class="rk" style="grid-template-columns:150px 1fr"><b style="color:${s.col}">${esc(s.name)}</b><span>${esc(s.d)}</span></div>`).join('')}<span class="ds" style="font-size:12px;color:var(--dim)">Таблица реакций и связки орудий — во вкладке «Связки».</span></div>
          <div class="tnode"><div class="h2">Советы</div>${TIPS.map(t => `<span class="ds" style="font-size:13px;color:var(--sub)">— ${esc(t)}</span>`).join('')}</div>
          <div class="tnode"><div class="h2">Расписание забега</div>${SECTORS.map(sc => `<div class="rk"><b>${esc(sc.code)}</b><span>${bossSchedule(sc.id).map(b => fmtTime(b.t) + ' ' + esc(BOSSES[b.id].name)).join(' · ')}</span></div>`).join('')}<div class="rk"><b>2:30+</b><span>Лейтенанты Роя — каждые 5 минут между боссами</span></div><div class="rk"><b>20:00+</b><span>Бесконечный режим после победы</span></div></div>
        </div>`;
      }
      return `<section class="screen menu solid" id="scr-codex"><div class="wrap">
        <div class="topbar"><button class="btn small" data-act="open" data-scr="title">← Назад</button><div><div class="eyebrow">Справочник</div><h2 class="h1">Техническая документация</h2></div></div>
        <div class="tabs">${tabs.map(t => `<button class="tab ${this.codexTab === t[0] ? 'on' : ''}" data-act="tab" data-id="${t[0]}">${t[1]}</button>`).join('')}</div>
        ${body}</div></section>`;
    },
    ach() {
      return `<section class="screen menu solid" id="scr-ach"><div class="wrap">
        <div class="topbar"><button class="btn small" data-act="open" data-scr="title">← Назад</button><div><div class="eyebrow">Достижения</div><h2 class="h1">${ACHIEVEMENTS.filter(a => SAVE.ach[a.id]).length} из ${ACHIEVEMENTS.length}</h2></div></div>
        <div class="ach-list">${ACHIEVEMENTS.map(a => `<div class="ach ${SAVE.ach[a.id] ? 'on' : ''}"><span class="nm">${SAVE.ach[a.id] ? '✓ ' : ''}${esc(a.name)}</span><span class="ds">${esc(a.d)}</span><span class="rw">+${a.r} лома${a.unlock ? ' · открывает: ' + esc(a.unlock) : ''}</span></div>`).join('')}</div>
      </div></section>`;
    },
    settings() {
      const S = SAVE.settings;
      return `<section class="screen menu solid" id="scr-settings"><div class="wrap">
        <div class="topbar"><button class="btn small" data-act="${G.state === 'pause' ? 'backToPause' : 'open'}" data-scr="title">← Назад</button><div><div class="eyebrow">Настройки</div><h2 class="h1">Конфигурация</h2></div></div>
        <div class="set-list">
          <div class="set-row"><label for="set-music">Музыка</label><input id="set-music" type="range" min="0" max="1" step="0.05" value="${S.music}" data-set="music"></div>
          <div class="set-row"><label for="set-sfx">Эффекты</label><input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${S.sfx}" data-set="sfx"></div>
          <div class="set-row"><span>Цифры урона</span><button class="btn small" data-act="toggle" data-k="dmg">${S.dmg ? 'Вкл' : 'Выкл'}</button></div>
          <div class="set-row"><span>Тряска экрана</span><button class="btn small" data-act="toggle" data-k="shake">${S.shake ? 'Вкл' : 'Выкл'}</button></div>
          <div class="set-row"><span>Камера</span><span class="seg">${[['front', 'Во весь рост'], ['top', 'Сверху']].map(v => `<button class="${(S.view || 'front') === v[0] ? 'on' : ''}" data-act="view" data-v="${v[0]}">${v[1]}</button>`).join('')}</span></div>
          <div class="set-row"><span>Проекция пола (наклон)</span><button class="btn small" data-act="proj">${S.proj !== false ? 'Вкл' : 'Выкл'}</button></div>
          <div class="set-row"><span>Качество графики (свечение)</span><span class="seg">${[['auto', 'Авто'], ['high', 'Высокое'], ['low', 'Низкое']].map(q => `<button class="${S.quality === q[0] ? 'on' : ''}" data-act="quality" data-q="${q[0]}">${q[1]}</button>`).join('')}</span></div>
          <div class="set-row"><span>Полный экран</span><button class="btn small" data-act="fullscreen">Переключить</button></div>
          <div class="sheet"><div class="in"><div class="eyebrow" style="margin-bottom:8px">Управление</div><div class="keys">
            <kbd>WASD / стрелки</kbd><span>движение (или зажмите мышь / ведите пальцем)</span>
            <kbd>Пробел</kbd><span>рывок с неуязвимостью</span>
            <kbd>E / Shift</kbd><span>овердрайв, когда шкала заполнена</span>
            <kbd>Esc / P</kbd><span>пауза</span>
            <kbd>1–4</kbd><span>выбор карточки при повышении уровня</span>
            <kbd>Геймпад</kbd><span>стик — движение, A — рывок, X/RT — овердрайв, Start — пауза</span>
          </div></div></div>
          ${this.confirmReset ? `<div class="confirm"><span>Стереть весь прогресс: лом, улучшения, достижения и открытия?</span><div class="row"><button class="btn small warn" data-act="wipe">Стереть</button><button class="btn small" data-act="refundNo">Отмена</button></div></div>` : `<div class="row"><button class="btn small warn" data-act="refundAsk">Сбросить прогресс</button></div>`}
        </div></div></section>`;
    },
  },

  act: {
    noop() { AUDIO.sfx('hurt'); },
    open(b) { this.confirmReset = false; this.open(b.dataset.scr); },
    pickRobot(b) { this.sel.robot = b.dataset.id; this.open('hangar'); },
    pickSector(b) { this.sel.sector = b.dataset.id; this.sel.threat = Math.min(this.sel.threat, SAVE.threat[b.dataset.id] || 0); this.open('hangar'); },
    thr(b) { this.sel.threat = clamp(this.sel.threat + parseInt(b.dataset.d, 10), 0, SAVE.threat[this.sel.sector] || 0); this.open('hangar'); },
    launch() {
      SAVE.last = { robot: this.sel.robot, sector: this.sel.sector, threat: this.sel.threat };
      persist();
      this.root.innerHTML = ''; this.screen = null;
      startRun(this.sel.robot, this.sel.sector, this.sel.threat);
    },
    buy(b) {
      const u = UPGRADES.find(x => x.id === b.dataset.id), r = SAVE.upg[u.id] || 0, cost = upgradeCost(u, r);
      if (r >= u.max || SAVE.scrap < cost) return;
      SAVE.scrap -= cost; SAVE.upg[u.id] = r + 1; persist();
      AUDIO.sfx('coin');
      this.open('workshop');
    },
    refundAsk() { this.confirmReset = true; this.open(this.screen); },
    refundNo() { this.confirmReset = false; this.open(this.screen); },
    refund() {
      let back = 0;
      for (const u of UPGRADES) { for (let i = 0; i < (SAVE.upg[u.id] || 0); i++) back += upgradeCost(u, i); }
      SAVE.scrap += back; SAVE.upg = {}; persist(); this.confirmReset = false; this.open('workshop');
    },
    wipe() { const s = SAVE.settings; SAVE = defaultSave(); SAVE.settings = s; persist(); this.confirmReset = false; this.open('title'); },
    tab(b) { this.codexTab = b.dataset.id; this.open('codex'); },
    toggle(b) { const k = b.dataset.k; SAVE.settings[k] = !SAVE.settings[k]; FX.dmgNumbers = SAVE.settings.dmg; persist(); this.reopenSettings(); },
    quality(b) { SAVE.settings.quality = b.dataset.q; RENDER.autoLow = false; persist(); resize(); this.reopenSettings(); },
    proj() { SAVE.settings.proj = SAVE.settings.proj === false; persist(); this.reopenSettings(); },
    view(b) { SAVE.settings.view = b.dataset.v; if (P) { P.view = b.dataset.v; RENDER.ghostKey = ''; } persist(); this.reopenSettings(); },
    fullscreen() {
      const d = document;
      try {
        if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
        else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {});
      } catch (e) { /* недоступно */ }
    },
    backToPause() { this.pause(true); },
    ptab(b) { this.pauseTab = b.dataset.id; this.pause(true); },
    // игровые
    pick(b) {
      const i = parseInt(b.dataset.i, 10), ch = this.luChoices[i];
      if (this.banishMode) {
        const key = ch.kind === 'part' ? 'part_' + ch.id : ch.id;
        if (ch.kind !== 'filler') G.banished.add(key);
        G.banishes--; this.banishMode = false;
        this.showLevelUp(rollChoices());
        return;
      }
      if (ch.kind === 'part' && P.parts[ch.id].rank === 2) { this.showBranch(ch); return; }
      AUDIO.sfx('pick');
      applyChoice(ch);
      this.resumePlay();
    },
    reroll() { if (G.rerolls <= 0) return; G.rerolls--; this.banishMode = false; this.showLevelUp(rollChoices()); },
    banish() { if (G.banishes <= 0) return; this.banishMode = !this.banishMode; for (const c of this.root.querySelectorAll('.card')) c.classList.toggle('banish-mode', this.banishMode); const b = this.root.querySelector('[data-act="banish"]'); if (b) b.textContent = this.banishMode ? 'Выберите карточку…' : 'Блокировка · ' + G.banishes; },
    skip() { G.scrapRun += 10; this.resumePlay(); },
    branch(b) { AUDIO.sfx('pick'); applyChoice(this.branchCh, b.dataset.b); this.resumePlay(); },
    branchBack() { this.showLevelUp(this.luChoices, true); },
    take() { if (this.chestTimer) { this.revealChest(); return; } applyChestRewards(this.chestRes); this.chestRes = null; this.resumePlay(); },
    resume() { this.resumePlay(); },
    pauseSettings() { this.open('settings'); this.modal = 'settings'; },
    quitAsk() { this.confirmQuit = true; this.pause(true); },
    quitNo() { this.confirmQuit = false; this.pause(true); },
    quit() { this.confirmQuit = false; this.closeModal(); G.state = 'play'; endRun(false); },
    again() { this.closeModal(); startRun(G.robot.id, G.sector.id, G.threat); },
    toHangar() { this.closeModal(); this.exitToMenu('hangar'); },
    toMenu() { this.closeModal(); this.exitToMenu('title'); },
    endless() { this.closeModal(); continueEndless(); },
    finish() { this.closeModal(); G.state = 'play'; endRun(true); },
  },
  reopenSettings() { if (G.state === 'pause') { this.open('settings'); this.modal = 'settings'; } else this.open('settings'); },
  setVal(k, v) { SAVE.settings[k] = v; AUDIO.setVol(k, v); persist(); },
  exitToMenu(scr) {
    G.state = 'menu'; FX.clear(); G.tf.clear();
    $('#hud').hidden = true;
    AUDIO.music(1, 0); AUDIO.muffle(false);
    menuInit();
    this.open(scr || 'title');
  },
  resumePlay() {
    this.closeModal();
    this.banishMode = false;
    G.state = 'play';
    AUDIO.muffle(false);
    if (G.pendingWin) { G.pendingWin = false; winRun(); }
  },

  /* ---------- повышение уровня ---------- */
  choiceInfo(ch) {
    if (ch.kind === 'wnew' || ch.kind === 'wup') {
      const def = WEAPONS[ch.id], w = P.weapons.find(x => x.id === ch.id), cur = w ? w.lvl : 0;
      const ready = P.parts[def.part].rank >= EVO_RANK, known = SAVE.discovered.evolutions[def.evo];
      const p = def.base, lk = linksFor(ch.id), done = lk.find(l => l.have);
      let link = null;
      if (done) link = { col: done.L.col, txt: (ch.kind === 'wnew' ? 'СВЯЗКА «' + done.L.name + '» · пара: ' : 'Связка «' + done.L.name + '» усилится · пара: ') + WEAPONS[done.other].name.toLowerCase(), on: true };
      else if (lk.length) link = { col: lk[0].L.col, txt: 'Пара для связки: ' + lk.map(l => WEAPONS[l.other].name.toLowerCase()).join(' или '), on: false };
      return {
        link,
        cls: ch.kind === 'wnew' ? 'k-new' : 'k-w', left: 'Орудие · ' + wcode(ch.id), tag: ch.kind === 'wnew' ? 'Новое' : 'Ур. ' + cur + ' → ' + (cur + 1),
        name: def.name, img: SPR.icons[ch.id], lv: pips(cur + 1, 8), lvTxt: 'ур. ' + (cur + 1) + '/8',
        fx: ch.kind === 'wnew' ? def.desc : def.levels[cur - 1].d,
        note: 'Эволюция' + (known ? ' «' + EVOS[def.evo].name + '»' : '') + ': ур. 8 + ' + PARTS[def.part].name + ' МК-III' + (ready ? ' ✓' : ''),
        dim: 'урон ' + Math.round((w ? w.p.dmg : p.dmg * P.stats.might)) + (p.cd ? ' · перезарядка ' + (w ? w.p.cd : p.cd * P.stats.cdMul).toFixed(2).replace('.', ',') + ' с' : ''),
      };
    }
    if (ch.kind === 'part') {
      const pr = P.parts[ch.id], nr = pr.rank + 1, def = PARTS[ch.id];
      const total = totalRanks() + 1, nf = formFor(total);
      const evos = WEAPON_ORDER.filter(id => WEAPONS[id].part === ch.id).map(id => WEAPONS[id].name.split(' ').pop());
      if (nr === 3) {
        return { cls: 'k-part', left: 'Модуль · ' + def.code, tag: 'Развилка', name: def.name + ' МК-III', part: ch.id, look: null,
          lv: pips(nr, 5, 'mag'), lvTxt: 'МК-' + ROMAN[nr] + '/V',
          fx: 'Выберите ветку: ' + Object.values(def.branches).map(B => '«' + B.name + '»').join(', ').replace(/, ([^,]*)$/, ' или $1'),
          note: nf > P.form ? '→ Форма ' + FORMS[nf].code + ': ' + FORMS[nf].name : 'Нужен для эволюций: ' + evos.join(', '), dim: def.role.toLowerCase() };
      }
      const rd = partRankDef(ch.id, nr, pr.branch);
      const L = cloneLook(P.look); L.parts[ch.id] = { rank: nr, branch: pr.branch };
      return { cls: 'k-part', left: 'Модуль · ' + def.code, tag: 'Трансформация', name: def.name + ' МК-' + ROMAN[nr] + ' · ' + rd.name, part: ch.id, look: L,
        lv: pips(nr, 5, 'mag'), lvTxt: 'МК-' + ROMAN[nr] + '/V', fx: rd.d,
        note: nf > P.form ? '→ Форма ' + FORMS[nf].code + ': ' + FORMS[nf].name : 'Нужен для эволюций: ' + evos.join(', '), dim: def.role.toLowerCase() };
    }
    const f = FILLERS.find(x => x.id === ch.id);
    return { cls: 'k-fill', left: 'Система', tag: 'Сверхразгон', name: f.name, img: SPR.icons[f.id], lv: '', lvTxt: '', fx: f.d, note: 'Все орудия и модули на пределе', dim: '' };
  },
  showLevelUp(choices, keepState) {
    this.luChoices = choices;
    G.state = 'levelup';
    const cards = choices.map((ch, i) => {
      const I = this.choiceInfo(ch);
      const fig = I.part ? `<canvas width="240" height="240" data-part="${I.part}" data-i="${i}"></canvas>` : `<img src="${I.img}" alt="">`;
      return `<button class="card ${I.cls}" data-act="pick" data-i="${i}">
        <span class="strip"><span>${esc(I.left)}</span><span class="tag">${esc(I.tag)}</span></span>
        <span class="num kbd-only">${i + 1}</span>
        <span class="fig">${fig}${I.dim ? `<span class="dimx">${esc(I.dim)}</span>` : ''}</span>
        <span class="body"><span class="nm">${esc(I.name)}</span>${I.lv ? `<span class="lvline">${I.lv}<span>${I.lvTxt}</span></span>` : ''}<span class="fx">${esc(I.fx)}</span><span class="note">${esc(I.note)}</span>${I.link ? `<span class="lnk ${I.link.on ? 'on' : ''}" style="--c:${I.link.col}">${esc(I.link.txt)}</span>` : ''}</span>
      </button>`;
    }).join('');
    const html = `<section class="screen overlay" id="scr-levelup"><div class="lu-wrap">
      <div class="lu-head"><span class="eyebrow">Уровень ${P.level}</span><h2 class="h1">Повышение уровня</h2><span class="mono" style="color:var(--sub);font-size:12px">Форма ${FORMS[P.form].code} · рангов модулей ${totalRanks()}/25</span></div>
      <div class="cards" style="--n:${choices.length}">${cards}</div>
      <div class="lu-actions">
        <button class="btn small" data-act="reroll" ${G.rerolls > 0 ? '' : 'disabled'}>Пересчёт · ${G.rerolls} <span class="k kbd-only">R</span></button>
        <button class="btn small warn" data-act="banish" ${G.banishes > 0 ? '' : 'disabled'}>Блокировка · ${G.banishes} <span class="k kbd-only">B</span></button>
        <button class="btn small" data-act="skip">Пропуск · +10 лома</button>
      </div></div></section>`;
    this.openModal('levelup', html);
    for (const cv of this.root.querySelectorAll('canvas[data-part]')) {
      const I = this.choiceInfo(choices[parseInt(cv.dataset.i, 10)]);
      const L = I.look || P.look;
      drawRobotPreview(cv, L, G.time, { highlight: cv.dataset.part, zoom: 1.05 });
    }
  },
  showBranch(ch) {
    this.branchCh = ch;
    const id = ch.id, def = PARTS[id];
    const keys = Object.keys(def.branches);
    const cards = keys.map((b, i) => {
      const B = def.branches[b];
      return `<button class="bcard" data-act="branch" data-b="${b}">
        <canvas width="320" height="240" data-bprev="${b}"></canvas>
        <span class="body"><span class="tg" style="color:${B.color}">Ветка ${b} · ${esc(B.tag)}</span><span class="nm">${esc(B.name)}</span>
        <ol>${B.ranks.map((r, k) => `<li><span>МК-${ROMAN[k + 3]}</span><b>${esc(r.name)}.</b> ${esc(r.d)}</li>`).join('')}</ol></span></button>`;
    }).join('');
    const html = `<section class="screen overlay" id="scr-branch"><div class="lu-wrap" style="max-width:${keys.length > 2 ? 1180 : 900}px">
      <div class="lu-head"><span class="eyebrow">Развилка трансформации</span><h2 class="h1">${esc(def.name)}: выберите ветку</h2></div>
      <div class="branch-cards">${cards}</div>
      <div class="lu-actions"><button class="btn small" data-act="branchBack">← К карточкам</button></div></div></section>`;
    this.openModal('branch', html);
    for (const cv of this.root.querySelectorAll('canvas[data-bprev]')) {
      const L = cloneLook(P.look); L.parts[id] = { rank: 3, branch: cv.dataset.bprev };
      this.previews.push({ cv, look: L, anim: true, highlight: id, zoom: 0.92 });
    }
  },

  /* ---------- контейнер ---------- */
  showChest(res) {
    this.chestRes = res;
    const html = `<section class="screen overlay" id="scr-chest"><div class="chest-wrap">
      <div class="eyebrow">${res.big ? 'Трофейный контейнер босса' : 'Контейнер снабжения'}</div>
      <div class="hexbox ${res.big ? 'gold' : ''}" id="hexbox"><div class="hx"></div><div class="hx2"></div></div>
      <div class="hexstream" id="hexstream"></div>
      <h2 class="h1" id="chest-title">Дешифровка…</h2>
      <div class="rewards" id="rewards"></div>
      <button class="btn primary" data-act="take" data-autofocus>Пропустить</button></div></section>`;
    this.openModal('chest', html);
    const hs = $('#hexstream');
    let n = 0;
    const tick = () => {
      if (!hs.isConnected) return;
      let s = ''; for (let i = 0; i < 96; i++) s += '0123456789ABCDEF'[(Math.random() * 16) | 0] + (i % 2 ? ' ' : '');
      hs.textContent = s; n++;
      if (n < 18 && this.chestTimer) this.chestTimer = setTimeout(tick, 60); else this.revealChest();
    };
    this.chestTimer = setTimeout(tick, 60);
  },
  revealChest() {
    if (!this.chestRes) return;
    clearTimeout(this.chestTimer); this.chestTimer = null;
    const res = this.chestRes;
    const hb = $('#hexbox'); if (hb) hb.classList.add('open');
    const t = $('#chest-title'); if (t) t.textContent = res.rewards.some(r => r.kind === 'evo') ? 'Эволюция!' : 'Получено';
    AUDIO.sfx('reveal');
    const rows = res.rewards.map((r, i) => {
      let img, nm, ds, cls = '';
      if (r.kind === 'evo') { img = SPR.icons[r.evo]; nm = 'Эволюция: ' + EVOS[r.evo].name; ds = EVOS[r.evo].desc; cls = 'evo'; }
      else if (r.kind === 'wup') { const w = P.weapons.find(x => x.id === r.id); img = SPR.icons[r.id]; nm = WEAPONS[r.id].name; ds = 'Уровень повышен'; }
      else {
        img = SPR.icons['part_' + r.id];
        const d = r.rank ? partRankDef(r.id, r.rank, r.branch) : null;
        nm = PARTS[r.id].name + (r.rank ? ' МК-' + ROMAN[r.rank] : '');
        ds = d ? d.name + ': ' + d.d : 'Трансформация модуля';
      }
      return `<div class="reward ${cls}" style="animation-delay:${i * 0.08}s"><img src="${img}" alt=""><div><div class="nm">${esc(nm)}</div><div class="ds">${esc(ds)}</div></div></div>`;
    }).join('') + `<div class="reward" style="animation-delay:${res.rewards.length * 0.08}s"><img src="${SPR.items.scrap.cv.toDataURL()}" alt=""><div><div class="nm">+${res.scrap} лома</div><div class="ds">Зачислено в итог забега</div></div></div>`;
    const rw = $('#rewards'); if (rw) rw.innerHTML = rows;
    const b = this.root.querySelector('[data-act="take"]'); if (b) { b.textContent = 'Забрать'; b.focus(); }
  },

  /* ---------- пауза и итоги ---------- */
  pause(force) {
    if (!force && G.state !== 'play') return;
    if (G.tf.blocking && !force) return;
    G.state = 'pause';
    AUDIO.muffle(true);
    const items = P.weapons.map(w => { const d = weaponDef(w); return `<div class="bitem"><img src="${SPR.icons[w.id]}" alt=""><div><b>${esc(d.name)}</b><div class="m">${w.evo ? 'эволюция' : 'ур. ' + w.lvl + '/8'} · урон ${fmtNum(G.dmgBy[w.id] || 0)}</div></div></div>`; }).join('');
    const parts = PART_ORDER.map(id => { const pr = P.parts[id], d = pr.rank ? partRankDef(id, pr.rank, pr.branch) : null; return `<div class="bitem"><img src="${SPR.icons['part_' + id]}" alt=""><div><b>${esc(PARTS[id].name)} МК-${ROMAN[pr.rank]}</b><div class="m">${d ? esc(d.name) : 'базовый'}${pr.branch ? ' · ' + esc(PARTS[id].branches[pr.branch].name) : ''}</div></div></div>`; }).join('');
    const S = P.stats;
    const links = LINKS.map(L => {
      const a = !!ownedBase(L.a), b = !!ownedBase(L.b);
      if (!a && !b) return '';
      const on = a && b, miss = a ? L.b : L.a;
      return `<div class="bitem lnkitem ${on ? 'on' : ''}" style="--c:${L.col}"><span class="pair"><img src="${SPR.icons[L.a]}" alt=""><img src="${SPR.icons[L.b]}" alt=""></span><div><b>${esc(L.name)}</b><div class="m">${on ? 'активна · ' + Math.round(linkK(L.id) * 100) + '% · урон ' + fmtNum(G.dmgBy['link_' + L.id] || 0) : 'нужно: ' + esc(WEAPONS[miss].name.toLowerCase())}</div></div></div>`;
    }).join('');
    const html = `<section class="screen overlay" id="scr-pause"><div class="pause-wrap">
      <div class="topbar"><div><div class="eyebrow">${esc(G.sector.name)} · ${fmtTime(G.time)}</div><h2 class="h1">Пауза</h2></div></div>
      <div class="tabs">${[['build', 'Сборка'], ['tree', 'Дерево эволюций']].map(t => `<button class="tab ${this.pauseTab === t[0] ? 'on' : ''}" data-act="ptab" data-id="${t[0]}">${t[1]}</button>`).join('')}</div>
      ${this.pauseTab === 'tree' ? evoTreeHTML(true) : `<div class="two"><div class="sheet"><div class="in" style="display:flex;flex-direction:column;gap:10px"><div class="eyebrow">Орудия</div><div class="buildlist">${items}</div>${links ? `<div class="eyebrow">Связки орудий</div><div class="buildlist">${links}</div>` : ''}<div class="eyebrow">Модули · форма ${FORMS[P.form].code} «${esc(FORMS[P.form].name)}»</div><div class="buildlist">${parts}</div></div></div>
      <div class="sheet"><div class="in"><div class="eyebrow" style="margin-bottom:8px">Характеристики</div><div class="statlist">
        <span>Прочность</span><b>${Math.round(P.hp)}/${S.maxHp}</b><span>Броня</span><b>${S.armor}</b><span>Регенерация</span><b>${S.regen.toFixed(1)}/с</b>
        <span>Урон</span><b>${fmtPct(S.might - 1)}</b><span>Перезарядка</span><b>−${Math.round((1 - S.cdMul) * 100)}%</b><span>Площадь</span><b>${fmtPct(S.area - 1)}</b>
        <span>Снаряды</span><b>+${S.amount}</b><span>Крит</span><b>${Math.round(S.crit * 100)}% ×${S.critDmg.toFixed(1)}</b><span>Скорость</span><b>${Math.round(S.speed)}</b>
        <span>Опыт</span><b>${fmtPct(S.growth - 1)}</b><span>Удача</span><b>${fmtPct(S.luck - 1)}</b><span>Воскрешения</span><b>${P.revives}</b>
      </div></div></div></div>`}
      <div class="row">
        <button class="btn primary" data-act="resume" data-autofocus>Продолжить</button>
        <button class="btn" data-act="pauseSettings">Настройки</button>
        ${this.confirmQuit ? `<span class="confirm" style="flex-direction:row;align-items:center;flex-wrap:wrap"><span>Завершить забег? Лом сохранится.</span><button class="btn small warn" data-act="quit">Завершить</button><button class="btn small" data-act="quitNo">Отмена</button></span>` : `<button class="btn warn" data-act="quitAsk">Завершить забег</button>`}
      </div></div></section>`;
    this.openModal('pause', html);
  },
  showVictory() {
    const html = `<section class="screen overlay" id="scr-victory"><div class="over-wrap" style="text-align:center;align-items:center">
      <div class="eyebrow">Ядро Роя уничтожено</div><h2 class="over-title win">Протокол завершён</h2>
      <p class="lead">Сектор «${esc(G.sector.name)}» зачищен${G.threat ? ' на угрозе ' + G.threat : ''}. Открыт следующий уровень угрозы. Можно продолжить бой в бесконечном режиме: Рой будет крепнуть каждую минуту, а лом продолжит копиться.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="endless" data-autofocus>Бесконечный режим</button><button class="btn gold" data-act="finish">Завершить забег</button></div></div></section>`;
    this.openModal('victory', html);
  },
  showGameOver(r) {
    $('#hud').hidden = true;
    const total = Object.values(r.dmgBy).reduce((a, b) => a + b, 0) || 1;
    const names = { mg: ['Мини-пушки многорука', 'part_arms'], burn: ['Горение', null], combo: ['Комбинации', null], crit: ['Цепные криты', null], legs: ['Шасси', 'part_legs'], core: ['Ядро', 'part_core'], back: ['Генератор', 'part_back'], tf: ['Трансформации', null], emp: ['ЭМИ-бомбы', null], od: ['Овердрайв', null], hazard: ['Ловушки сектора', null], relay: ['Орбитальный удар', null] };
    for (const id in REACTIONS) names['rx_' + id] = ['Реакция: ' + REACTIONS[id].name, null];
    for (const L of LINKS) names['link_' + L.id] = ['Связка: ' + L.name, 'link:' + L.a];
    const rows = Object.entries(r.dmgBy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => {
      const d = WEAPONS[k] || EVOS[k];
      const nm = d ? d.name : (names[k] ? names[k][0] : k);
      const ic = d ? SPR.icons[k] : names[k] && names[k][1] ? SPR.icons[names[k][1].replace('link:', '')] : null;
      return `<div class="dmgrow">${ic ? `<img src="${ic}" alt="">` : '<span></span>'}<div><div>${esc(nm)}</div><div class="bar"><i style="width:${(v / total * 100).toFixed(1)}%"></i></div></div><span class="v">${fmtNum(v)}</span></div>`;
    }).join('');
    const ach = r.ach.map(id => { const a = ACHIEVEMENTS.find(x => x.id === id); return a ? `<div>✓ <b>${esc(a.name)}</b> +${a.r}${a.unlock ? ' · открыто: ' + esc(a.unlock) : ''}</div>` : ''; }).join('');
    const html = `<section class="screen overlay" id="scr-over"><div class="over-wrap">
      <div><div class="eyebrow">${esc(G.sector.name)} · ${esc(G.robot.name)}${G.threat ? ' · угроза ' + G.threat : ''}</div>
      <h2 class="over-title ${r.victory ? 'win' : 'lose'}">${r.victory ? 'Протокол завершён' : 'Искра погасла'}</h2>${r.rec ? '<div class="eyebrow" style="color:var(--gold);margin-top:6px">Новый рекорд сектора</div>' : ''}</div>
      <div class="kpis"><div class="kpi"><div class="l">Время</div><div class="v">${fmtTime(r.time)}</div></div><div class="kpi"><div class="l">Уровень</div><div class="v">${r.level}</div></div><div class="kpi"><div class="l">Уничтожено</div><div class="v">${fmtInt(r.kills)}</div></div><div class="kpi"><div class="l">Форма</div><div class="v">${FORMS[r.form].code}</div></div></div>
      <div class="two"><div class="sheet"><div class="in"><div class="eyebrow" style="margin-bottom:8px">Урон по источникам</div><div class="dmgtable">${rows || '<span class="lead">Нет данных</span>'}</div></div></div>
      <div class="sheet"><div class="in" style="display:flex;flex-direction:column;gap:10px"><div class="eyebrow">Добыча</div><div class="loot"><div>Собрано в бою: <b>${fmtInt(r.scrapRun)}</b></div><div>Бонус за забег: <b>${fmtInt(r.bonus)}</b></div><div>Итого лома: <b>${fmtInt(r.total)}</b> · на счету ${fmtInt(SAVE.scrap)}</div></div>${ach ? `<div class="eyebrow">Достижения</div><div class="loot">${ach}</div>` : ''}</div></div></div>
      <div class="row"><button class="btn primary" data-act="again" data-autofocus>Ещё раз</button><button class="btn" data-act="toHangar">В ангар</button><button class="btn" data-act="toMenu">В меню</button></div>
    </div></section>`;
    this.openModal('over', html);
  },

  /* ---------- HUD ---------- */
  buildHud() {
    const hud = $('#hud');
    hud.innerHTML = `<div class="top">
        <div class="xpbar"><i id="h-xp"></i></div>
        <div class="hudrow">
          <div class="slots"><div class="slotrow" id="h-weap"></div><div class="slotrow" id="h-parts"></div></div>
          <span class="lvl">УР <b id="h-lvl">1</b></span>
          <div class="stats-r"><span class="chip k" id="h-kills">0</span><span class="chip s" id="h-scrap">0</span><button class="iconbtn pausebtn" data-hud="pause" aria-label="Пауза"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" fill="#e8f2ff"/><rect x="9.5" y="2" width="3.5" height="12" fill="#e8f2ff"/></svg></button></div>
        </div>
      </div>
      <div class="timer" id="h-time">00:00</div>
      <div class="alertchip" id="h-alert" hidden><span>ТРЕВОГА РОЯ</span><b id="h-alertlv">II</b><span class="pips" id="h-alertpips"></span></div>
      <div class="buffchip" id="h-buff" hidden><span>ЭНЕРГОСЕТЬ</span><b>+25%</b><span id="h-bufft">30</span></div>
      <div class="bossbar" id="h-boss" hidden><span class="nm" id="h-bossname"></span><div class="bar"><i id="h-bossbar"></i><em style="left:33.3%"></em><em style="left:66.6%"></em></div></div>
      <div class="bottom"><div class="odwrap" id="h-odwrap"><div class="odlbl"><span>ОВЕРДРАЙВ <span class="kbd-only">[E]</span></span><span id="h-odpct">0%</span></div><div class="odbar"><i id="h-od"></i></div><div class="dashpips" id="h-dash"></div></div></div>
      <div class="touchbtns" id="touchbtns" hidden>
        <button class="tbtn" id="t-dash" aria-label="Рывок">РЫВОК</button>
        <button class="tbtn od" id="t-od" aria-label="Овердрайв"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,79,154,.25)" stroke-width="5"/><circle id="t-odring" cx="50" cy="50" r="47" fill="none" stroke="#ff4f9a" stroke-width="5" stroke-dasharray="295.3" stroke-dashoffset="295.3"/></svg>ОВЕРДРАЙВ</button>
      </div>
      <div class="hint" id="h-hint"></div>`;
    const H = this.hud;
    for (const id of ['h-xp', 'h-lvl', 'h-kills', 'h-scrap', 'h-time', 'h-boss', 'h-bossname', 'h-bossbar', 'h-alert', 'h-alertlv', 'h-alertpips', 'h-buff', 'h-bufft', 'h-od', 'h-odpct', 'h-odwrap', 'h-dash', 'h-weap', 'h-parts', 'h-hint', 't-od', 't-odring', 't-dash']) H[id] = document.getElementById(id);
    hud.addEventListener('click', e => { const b = e.target.closest('[data-hud]'); if (b && b.dataset.hud === 'pause') this.pause(); });
    const hold = (el, name) => {
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); AUDIO.init(); INPUT.press(name); el.classList.add('down'); });
      el.addEventListener('pointerup', () => el.classList.remove('down'));
    };
    hold(H['t-dash'], 'dash'); hold(H['t-od'], 'od');
  },
  onRunStart() {
    this.closeModal(); this.screen = null;
    $('#hud').hidden = false;
    this.sig = ''; this.lastSec = -1;
    this.touchMode(INPUT.touchSeen || matchMedia('(pointer: coarse)').matches);
    const H = this.hud;
    H['h-hint'].textContent = INPUT.touchSeen || matchMedia('(pointer: coarse)').matches ? 'Ведите пальцем по экрану — движение. Орудия стреляют сами.' : 'WASD — движение · Пробел — рывок · E — овердрайв · орудия стреляют сами';
    H['h-hint'].style.opacity = 1;
    this.hintT = 9;
  },
  frame(dt) {
    if (G.state === 'menu' || !P) return;
    const H = this.hud;
    if (!H['h-xp']) return;
    H['h-xp'].style.transform = 'scaleX(' + clamp(P.xp / P.xpNext, 0, 1).toFixed(4) + ')';
    const sec = Math.floor(G.time);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      H['h-time'].textContent = fmtTime(G.time);
      H['h-lvl'].textContent = P.level;
      H['h-kills'].textContent = '☠ ' + fmtNum(G.kills);
      H['h-scrap'].textContent = '⚙ ' + fmtNum(G.scrapRun);
    }
    const boss = G.enemies.find(e => e.boss && e.alive);
    const bs = G.surgeT > 0 ? Math.ceil(G.surgeT) : 0;
    if (this.buffSig !== bs) { this.buffSig = bs; H['h-buff'].hidden = !bs; if (bs) H['h-bufft'].textContent = bs + ' с'; }
    const al = G.alertLvl || 1;
    if (this.alertSig !== al + (boss ? 'b' : '')) {
      this.alertSig = al + (boss ? 'b' : '');
      H['h-alert'].hidden = al < 2 || !!boss;
      H['h-alertlv'].textContent = ROMAN[al];
      H['h-alertpips'].innerHTML = [1, 2, 3, 4, 5].map(i => `<i class="${i <= al ? 'on' : ''}"></i>`).join('');
      H['h-alert'].dataset.lv = al;
    }
    if (boss) {
      H['h-boss'].hidden = false;
      H['h-bossname'].textContent = boss.name + (boss.intro > 0 ? ' · ВЫСАДКА' : boss.phaseT > 0 ? ' · СМЕНА ФАЗЫ' : boss.phase > 1 ? ' · ФАЗА ' + ROMAN[boss.phase] : '') + (boss.enraged ? ' · ЯРОСТЬ' : '') + (boss.dmgRes ? ' · ЩИТ' : '');
      H['h-bossbar'].style.transform = 'scaleX(' + clamp(boss.hp / boss.maxHp, 0, 1).toFixed(4) + ')';
    } else H['h-boss'].hidden = true;
    const odq = P.od.meter / 100, full = odq >= 1 && !P.od.active;
    H['h-od'].style.transform = 'scaleX(' + odq.toFixed(3) + ')';
    H['h-odpct'].textContent = P.od.active ? 'АКТИВЕН' : full ? 'ГОТОВ' : Math.floor(odq * 100) + '%';
    H['h-odwrap'].classList.toggle('full', full);
    H['t-od'].classList.toggle('full', full);
    H['t-odring'].setAttribute('stroke-dashoffset', (295.3 * (1 - odq)).toFixed(1));
    // слоты
    const evos = eligibleEvos().map(e => e.w.id);
    const sig = P.weapons.map(w => w.id + w.lvl).join() + '|' + PART_ORDER.map(k => P.parts[k].rank + (P.parts[k].branch || '')).join() + '|' + evos.join() + '|' + P.dash.charges + P.dash.max;
    if (sig !== this.sig) {
      this.sig = sig;
      let ws = '';
      for (let i = 0; i < MAX_WEAPONS; i++) {
        const w = P.weapons[i];
        ws += w ? `<div class="slot ${w.evo ? 'evo' : ''} ${evos.includes(w.id) ? 'ready' : ''}" title="${esc(weaponDef(w).name)}"><img src="${SPR.icons[w.id]}" alt=""><span class="lv">${w.evo ? '★' : w.lvl}</span></div>` : '<div class="slot"></div>';
      }
      H['h-weap'].innerHTML = ws;
      H['h-parts'].innerHTML = PART_ORDER.map(k => { const pr = P.parts[k]; return `<div class="slot part" title="${esc(PARTS[k].name)}"><img src="${SPR.icons['part_' + k]}" alt="" style="opacity:${pr.rank ? 1 : 0.35}">${pr.branch ? `<span class="br" style="color:${PARTS[k].branches[pr.branch].color}">${pr.branch}</span>` : ''}<span class="lv">${pr.rank ? ROMAN[pr.rank] : ''}</span></div>`; }).join('');
      let dp = ''; for (let i = 0; i < P.dash.max; i++) dp += `<i class="${i < P.dash.charges ? 'on' : ''}"></i>`;
      H['h-dash'].innerHTML = dp;
    }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) H['h-hint'].style.opacity = 0; }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.nextToast(); }
  },
  drawPreviews(t) {
    for (const p of this.previews) {
      if (!p.cv.isConnected) continue;
      drawRobotPreview(p.cv, p.look, t, { anim: p.anim, highlight: p.highlight, zoom: p.zoom, moving: 0 });
    }
    for (const cv of this.root.querySelectorAll('canvas[data-enemy], canvas[data-boss]')) {
      if (cv.dataset.done) continue;
      cv.dataset.done = 1;
      if (cv.dataset.enemy) drawEnemyPreview(cv, cv.dataset.enemy); else drawBossPreview(cv, cv.dataset.boss);
    }
  },

  /* ---------- баннеры ---------- */
  banner(t, s, col) {
    const b = $('#banner');
    b.innerHTML = `<span class="t c-${col || 'cyan'}">${esc(t)}</span>${s ? `<span class="s">${esc(s)}</span>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  tfBanner(part, rank, branch, def) {
    const b = $('#tfcard');
    const br = branch && rank >= 3 ? ' · ' + PARTS[part].branches[branch].name : '';
    b.innerHTML = `<div class="sheet"><div class="in"><span class="code">${PARTS[part].code} · ${esc(PARTS[part].name.toUpperCase())} МК-${ROMAN[rank]}${esc(br.toUpperCase())}</span><span class="nm">${esc(def.name)}</span><span class="ds">${esc(def.d)}</span><span class="stamp">ОТК<small>ПРИНЯТО</small></span></div></div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    setTimeout(() => AUDIO.sfx('stamp'), 600);
  },
  mountCard(w) {
    const b = $('#tfcard'), d = weaponDef(w);
    b.innerHTML = `<div class="sheet"><div class="in"><span class="code">МОНТАЖ · ${wcode(baseOf(w))} → ${esc(SLOT_NAME[w.slot].toUpperCase())}</span><span class="nm">${esc(d.name)}</span><span class="ds">${esc(d.desc)}</span><span class="stamp">ОТК<small>ПРИНЯТО</small></span></div></div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    setTimeout(() => AUDIO.sfx('stamp'), 900);
  },
  formCard(f) {
    const b = $('#formcard');
    b.innerHTML = `<div class="box"><span class="ey">ФОРМА ${FORMS[f].code}</span><span class="ttl">${esc(FORMS[f].name.toUpperCase())}</span><span class="ds">${esc(FORMS[f].d || '')}</span></div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  evolveCard(wid, evo) {
    const b = $('#evocard');
    b.innerHTML = `<span class="ey">ЭВОЛЮЦИЯ ОРУДИЯ</span><span class="icons"><img src="${SPR.icons[wid]}" alt=""><span class="arr">▸▸</span><img src="${SPR.icons[evo]}" alt=""></span><span class="ttl">${esc(EVOS[evo].name)}</span><span class="ds">${esc(EVOS[evo].desc)}</span>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  bossWarn(B) {
    const b = $('#bosswarn');
    b.innerHTML = `<div class="box"><span class="ey">⚠ ВНИМАНИЕ · КРУПНАЯ ЦЕЛЬ</span><span class="ttl">${esc(B.name)}</span><span class="ds">${esc(B.title)} · ${esc(B.d)}</span></div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  toast(a) { this.toastQ.push(a); if (this.toastT <= 0) this.nextToast(); },
  nextToast() {
    const a = this.toastQ.shift();
    const b = $('#toast');
    if (!a) { b.classList.remove('show'); return; }
    b.innerHTML = `<div class="sheet"><div class="in"><div><div class="ey">ДОСТИЖЕНИЕ · +${a.r} ЛОМА</div><div class="nm">${esc(a.name)}</div><div class="ds">${esc(a.d)}${a.unlock ? ' · открыто: ' + esc(a.unlock) : ''}</div></div></div></div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.toastT = 3.5;
    AUDIO.sfx('reveal');
  },
};
