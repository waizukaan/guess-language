'use strict';

const $ = (id) => document.getElementById(id);
const player = $('player');
const RING = 339.3;

const state = {
  groups: [],
  languages: [],
  clips: {},       // dil id -> klip listesi
  group: null,
  pool: [],        // bu gruptaki, klibi olan diller
  current: null,   // bu turun dili
  clip: null,
  next: null,      // önceden seçilmiş sonraki tur { lang, clip }
  used: {},        // dil id -> çalınan klip adları
  answered: false,
  score: 0,
  round: 0,
  streak: 0,
  mistakes: {},    // "duyulan|seçilen" -> sayı
  optionCount: 4,
  failures: 0
};

// ---------------------------------------------------------------- ayarlar

function loadSetting(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* yoksay */ }
}

// ---------------------------------------------------------------- başlangıç

async function init() {
  state.optionCount = parseInt(loadSetting('dt-options', '4'), 10) || 4;
  renderOptionSetting();

  try {
    const [langs, manifest] = await Promise.all([
      fetch('languages.json', { cache: 'no-cache' }).then(r => r.json()),
      fetch('clips/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { languages: {} })).catch(() => ({ languages: {} }))
    ]);
    state.groups = langs.groups;
    state.languages = langs.languages;
    for (const [id, entry] of Object.entries(manifest.languages || {})) state.clips[id] = entry.clips || [];
  } catch (e) {
    showNotice('Dil listesi yüklenemedi. Sayfayı yenilemeyi dene.');
    return;
  }

  renderGroups();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

const hasClips = (lang) => (state.clips[lang.id] || []).length > 0;
const membersOf = (group) => group.id === 'tum'
  ? state.languages
  : state.languages.filter(l => l.groups.includes(group.id));

function show(screen) {
  $('screen-groups').hidden = screen !== 'groups';
  $('screen-game').hidden = screen !== 'game';
  window.scrollTo(0, 0);
}

function showNotice(html) {
  $('notice').innerHTML = html;
  $('notice').hidden = false;
}

// ---------------------------------------------------------------- grup ekranı

function renderOptionSetting() {
  for (const b of $('opt-count').children) {
    b.classList.toggle('on', parseInt(b.dataset.n, 10) === state.optionCount);
    b.onclick = () => {
      state.optionCount = parseInt(b.dataset.n, 10);
      saveSetting('dt-options', String(state.optionCount));
      renderOptionSetting();
    };
  }
}

function renderGroups() {
  const list = $('group-list');
  list.innerHTML = '';

  if (!state.languages.some(hasClips)) {
    showNotice('Henüz ses klibi yok. Önce klip toplayıcıyı çalıştır: <code>python3 tools/collect_clips.py</code>');
  }

  for (const g of state.groups) {
    const ready = membersOf(g).filter(hasClips);
    if (ready.length < 2) continue;

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'group' + (g.id === 'top' || g.id === 'bm' ? ' featured' : '');
    btn.innerHTML = `
      <span class="group-head">
        <span class="group-name"></span>
        <span class="group-count">${ready.length} dil</span>
      </span>
      <span class="group-langs"></span>`;
    btn.querySelector('.group-name').textContent = g.name;
    btn.querySelector('.group-langs').textContent = ready.map(l => l.name).join(', ');
    btn.onclick = () => startGroup(g);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------- oyun

function startGroup(group) {
  const members = membersOf(group);
  Object.assign(state, {
    group,
    pool: members.filter(hasClips),
    current: null,
    next: null,
    score: 0,
    round: 0,
    streak: 0,
    mistakes: {}
  });

  const missing = members.filter(l => !hasClips(l)).map(l => l.name);
  $('missing').textContent = missing.length
    ? `Ses kaynağı bulunamadığı için bu grupta olmayan diller: ${missing.join(', ')}`
    : '';
  $('group-title').textContent = group.name;
  renderMistakes();
  show('game');
  newRound();
}

function pickRound(exclude) {
  const candidates = state.pool.filter(l => l !== exclude);
  const lang = candidates[Math.floor(Math.random() * candidates.length)];
  return { lang, clip: nextClip(lang) };
}

function newRound() {
  state.answered = false;
  state.failures = 0;
  $('reveal').hidden = true;
  $('btn-next').disabled = true;

  const round = state.next && state.next.lang !== state.current ? state.next : pickRound(state.current);
  state.next = null;
  state.current = round.lang;

  renderOptions();
  updateScore();
  setStatus('Hangi dil?');
  play(round.clip);
}

// Bir dilin kliplerini, hepsi çalınana kadar tekrar etmeden verir
function nextClip(lang) {
  const all = state.clips[lang.id];
  let used = state.used[lang.id];
  if (!used || used.size >= all.length) used = state.used[lang.id] = new Set();
  const fresh = all.filter(c => !used.has(c.f));
  const clip = fresh[Math.floor(Math.random() * fresh.length)];
  used.add(clip.f);
  return clip;
}

// Şıklar: doğru cevap + mümkünse akraba diller + rastgele diller
function renderOptions() {
  const count = Math.min(state.optionCount, state.pool.length);
  const cur = state.current;
  const others = state.pool.filter(l => l !== cur);
  const kinMax = count >= 6 ? 3 : 2;

  const kin = shuffle(others.filter(l => cur.cluster && l.cluster === cur.cluster)).slice(0, kinMax);
  const rest = shuffle(others.filter(l => !kin.includes(l))).slice(0, count - 1 - kin.length);
  const options = shuffle([cur, ...kin, ...rest]);

  const box = $('options');
  box.innerHTML = '';
  options.forEach((lang, i) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.dataset.id = lang.id;
    btn.innerHTML = `<span class="key">${i + 1}</span><span class="name"></span>`;
    btn.querySelector('.name').textContent = lang.name;
    btn.onclick = () => answer(btn, lang);
    box.appendChild(btn);
  });
}

function answer(btn, chosen) {
  if (state.answered) return;
  state.answered = true;
  state.round++;

  const cur = state.current;
  const ok = chosen === cur;
  if (ok) {
    state.score++;
    state.streak++;
  } else {
    state.streak = 0;
    const key = `${cur.id}|${chosen.id}`;
    state.mistakes[key] = (state.mistakes[key] || 0) + 1;
    renderMistakes();
  }

  for (const b of $('options').children) {
    b.disabled = true;
    if (b.dataset.id === cur.id) b.classList.add('correct');
    else if (b === btn) b.classList.add('wrong');
  }

  setStatus(ok ? `Doğru — ${cur.name}` : `Yanlış — bu ${cur.name}`, ok ? 'ok' : 'bad');
  showReveal();
  $('btn-next').disabled = false;
  $('btn-next').focus({ preventScroll: true });
  updateScore();

  // Sonraki turun sesini şimdiden ısıt
  state.next = pickRound(cur);
  fetch(clipUrl(state.next.lang, state.next.clip)).catch(() => {});
}

function showReveal() {
  const c = state.clip;
  if (!c) return;
  $('reveal-text').textContent = c.text ? `“${c.text}”` : '';
  const src = c.src === 'fleurs' ? 'Google FLEURS' : 'Mozilla Common Voice';
  $('reveal-src').textContent = c.dur ? `${src} · ${Math.round(c.dur)} sn` : src;
  $('reveal').hidden = !c.text && !c.src;
}

function renderMistakes() {
  const entries = Object.entries(state.mistakes).sort((a, b) => b[1] - a[1]);
  $('mistakes').hidden = entries.length === 0;
  const byId = Object.fromEntries(state.languages.map(l => [l.id, l.name]));
  const list = $('mistake-list');
  list.innerHTML = '';
  for (const [key, n] of entries.slice(0, 8)) {
    const [heard, chosen] = key.split('|');
    const li = document.createElement('li');
    li.innerHTML = '<span><span class="heard"></span> → <span class="chosen"></span></span><span class="times"></span>';
    li.querySelector('.heard').textContent = byId[heard];
    li.querySelector('.chosen').textContent = byId[chosen];
    li.querySelector('.times').textContent = `${n}×`;
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------- ses

const clipUrl = (lang, clip) => `clips/${lang.id}/${clip.f}`;

function play(clip) {
  state.clip = clip;
  setRing(0);
  $('btn-play').classList.add('loading');
  player.src = clipUrl(state.current, clip);
  player.play().catch(() => {
    // Tarayıcı otomatik çalmayı engellediyse kullanıcı ▶'a basar
    $('btn-play').classList.remove('loading');
    setPlayIcon();
  });
}

function setRing(fraction) {
  $('ring').style.strokeDashoffset = String(RING * (1 - Math.min(1, fraction)));
}

function setPlayIcon() {
  const playing = !player.paused && !player.ended;
  $('btn-play').classList.toggle('playing', playing);
  $('play-icon').textContent = playing ? '❚❚' : player.ended ? '↻' : '▶';
}

player.addEventListener('playing', () => { $('btn-play').classList.remove('loading'); setPlayIcon(); });
player.addEventListener('pause', setPlayIcon);
player.addEventListener('ended', () => { setRing(1); setPlayIcon(); });
player.addEventListener('timeupdate', () => {
  if (player.duration) setRing(player.currentTime / player.duration);
});
player.addEventListener('error', () => {
  if (!state.current || !player.getAttribute('src')) return;
  // Bozuk ya da inmeyen dosya: aynı dilden başka bir kayıt dene
  if (++state.failures <= 3) play(nextClip(state.current));
  else { $('btn-play').classList.remove('loading'); setStatus('Ses yüklenemedi. Bağlantını kontrol et.', 'bad'); }
});

function togglePlay() {
  if (!player.getAttribute('src')) return;
  if (player.ended) player.currentTime = 0;
  if (player.paused) player.play().catch(() => {});
  else player.pause();
}

function stopAudio() {
  player.pause();
  player.removeAttribute('src');
  player.load();
  setRing(0);
  setPlayIcon();
}

// ---------------------------------------------------------------- yardımcılar

function setStatus(text, mode) {
  $('status').textContent = text;
  $('status').className = `status ${mode || ''}`;
}

function updateScore() {
  $('score').textContent = `${state.score} / ${state.round}`;
  $('streak').textContent = state.streak >= 3 ? `${state.streak} seri` : '';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- kontroller

$('btn-play').onclick = togglePlay;
$('btn-next').onclick = () => newRound();
$('btn-other').onclick = () => {
  state.failures = 0;
  play(nextClip(state.current));
  if (state.answered) showReveal();
};
$('btn-back').onclick = () => {
  stopAudio();
  show('groups');
};

document.addEventListener('keydown', (e) => {
  if ($('screen-game').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const opts = $('options').children;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= opts.length) { opts[n - 1].click(); return; }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'r' || e.key === 'R') { $('btn-other').click(); return; }
  if (e.key === 'Enter' && !$('btn-next').disabled) { e.preventDefault(); newRound(); }
  if (e.key === 'Escape') $('btn-back').click();
});

init();
