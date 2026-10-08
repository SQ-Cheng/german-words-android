'use strict';
const PREF_KEY = 'german_android_preferences_v1';
let preferences;
try { preferences = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (_) { preferences = {}; }
if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
function normalizePreferences(value) {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const books = result.books && typeof result.books === 'object' && !Array.isArray(result.books) ? result.books : {};
  result.books = Object.assign(Object.create(null), books);
  return result;
}
preferences = normalizePreferences(preferences);
let autoPlayEnabled = preferences.autoPlay !== false;
let restoring = false;
let libraryOpen = false;
let importBusy = false;
audioUnlocked = true;

function openLibrary() {
  libraryOpen = true;
  document.getElementById('library').classList.add('open');
  document.getElementById('scrim').classList.add('open');
}
function closeLibrary() {
  libraryOpen = false;
  document.getElementById('library').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
}
function handleAndroidBack() { if (libraryOpen) { closeLibrary(); return true; } return false; }
function setImportBusy(busy) {
  importBusy = busy;
  document.querySelectorAll('.btn-group button').forEach(b => b.disabled = busy);
  if (busy) document.getElementById('sidebarStatus').textContent = '正在导入…';
  else if (document.getElementById('sidebarStatus').textContent === '正在导入…') document.getElementById('sidebarStatus').textContent = '';
}
function pauseStudyAudio() {
  if (autoPlayTimer) { clearTimeout(autoPlayTimer); autoPlayTimer = null; }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (window.Android) Android.stopAudio();
}
function toggleAutoPlay() {
  autoPlayEnabled = !autoPlayEnabled;
  if (!autoPlayEnabled) pauseStudyAudio();
  lastAutoKey = null;
  updateUI();
}
function saveStudy() {
  if (restoring) return;
  preferences.file = currentFileName;
  preferences.mode = currentMode;
  preferences.view = currentView;
  preferences.filter = isFilterActive;
  preferences.autoPlay = autoPlayEnabled;
  if (currentFileName && currentFileWords.length) {
    preferences.books[currentFileName] = {
      word: displayWords[currentIndex] && displayWords[currentIndex].id,
      shuffled: isShuffled,
      order: isShuffled ? orderedWords.map(w => w.id) : undefined
    };
  }
  try { localStorage.setItem(PREF_KEY, JSON.stringify(preferences)); }
  catch (_) { notify('手机存储不足，无法保存学习进度', 'error'); }
}
function paintStudy() {
  const title = currentFileName ? currentFileName.replace(/_单词汇总\.xlsx$/i, ' · 单元词汇').replace(/\.xlsx$/i, '') : '选择一份词表';
  document.getElementById('lessonTitle').textContent = title;
  document.getElementById('lessonCount').textContent = currentFileWords.length + ' 词';
  document.getElementById('studyProgress').style.width = (displayWords.length ? (currentIndex + 1) / displayWords.length * 100 : 0) + '%';
  document.querySelector('.progress-track').setAttribute('aria-valuenow', String(displayWords.length ? Math.round((currentIndex + 1) / displayWords.length * 100) : 0));
  const star = document.querySelector('.star-mark');
  const word = displayWords[currentIndex];
  star.textContent = word && word.marked ? '★' : '☆';
  star.setAttribute('aria-pressed', String(!!(word && word.marked)));
  document.getElementById('autoPlayButton').textContent = '自动发音 · ' + (autoPlayEnabled ? '开' : '关');
  document.getElementById('autoPlayButton').setAttribute('aria-pressed', String(autoPlayEnabled));
  const shuffle = document.getElementById('btnShuffle');
  shuffle.textContent = isShuffled ? '恢复顺序' : '乱序';
  shuffle.classList.toggle('active', isShuffled);
  shuffle.setAttribute('aria-pressed', String(isShuffled));
  shuffle.disabled = !currentFileWords.length;
  document.getElementById('btnFilter').setAttribute('aria-pressed', String(isFilterActive));
}
// Touch gestures ignore taps on controls and vertical scrolling inside long cards.
let touchStart = null;
let suppressTap = false;
const card = document.getElementById('cardView');
card.addEventListener('touchstart', e => {
  if (e.target.closest('button') || e.touches.length !== 1) { touchStart = null; return; }
  touchStart = { x:e.touches[0].clientX, y:e.touches[0].clientY };
}, {passive:true});
card.addEventListener('touchend', e => {
  if (!touchStart || !e.changedTouches.length) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    suppressTap = true;
    if (dx < 0) nextCard(); else prevCard();
    setTimeout(() => suppressTap = false, 350);
  }
}, {passive:true});
card.addEventListener('click', e => { if (suppressTap) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseStudyAudio(); });

function exportStudyBackup() {
  saveStudy();
  Android.exportBackup(JSON.stringify({version:1, marks:JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), preferences}, null, 2));
}
function restoreBackup(raw) {
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !data.marks || typeof data.marks !== 'object' || Array.isArray(data.marks)) throw new Error('备份格式不正确');
    const safeMarks = {};
    for (const [book,words] of Object.entries(data.marks)) {
      if (!Array.isArray(words) || !words.every(w => typeof w === 'string')) throw new Error('星标格式不正确');
      Object.defineProperty(safeMarks, book, {value:words, enumerable:true});
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeMarks));
    if (data.preferences && typeof data.preferences === 'object' && !Array.isArray(data.preferences)) {
      preferences = normalizePreferences(data.preferences);
      localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
    }
    applyPreferences();
    reloadLibrary();
    notify('学习进度已恢复', 'info');
  } catch (e) { notify('恢复失败：' + e.message, 'error'); }
}
function applyPreferences() {
  preferences = normalizePreferences(preferences);
  currentMode = ['normal','test-zh','test-de'].includes(preferences.mode) ? preferences.mode : 'normal';
  currentView = preferences.view === 'list' ? 'list' : 'card';
  isFilterActive = preferences.filter === true;
  autoPlayEnabled = preferences.autoPlay !== false;
  document.getElementById('modeSelect').value = currentMode;
  document.getElementById('btnFilter').classList.toggle('active', isFilterActive);
  document.getElementById('btnCardView').classList.toggle('active', currentView === 'card');
  document.getElementById('btnListView').classList.toggle('active', currentView === 'list');
}
async function reloadLibrary(selectImported) {
  try {
    const manifest = window.Android ? JSON.parse(Android.manifest()) : await (await fetch('manifest.json')).json();
    const files = manifest.map(item => ({
      name:item.name, webkitRelativePath:item.path, url:new URL(item.url.split('/').map(encodeURIComponent).join('/'),location.href).href,
      root:item.imported ? item.path.split('/')[0] : 'built-in',
      imported:!!item.imported,
      arrayBuffer:async function () {
        const response = await fetch(this.url);
        if (!response.ok) throw new Error('词表无法读取');
        return response.arrayBuffer();
      }
    }));
    handleFiles(files);
    const names = Object.keys(fileMap);
    const newestBook = selectImported && files.filter(file => file.imported && /\.xlsx$/i.test(file.name)).pop();
    const imported = newestBook && names.find(name => fileMap[name].url === newestBook.url);
    const chosen = imported || (fileMap[preferences.file] ? preferences.file : names[0]);
    if (chosen) await loadFile(chosen); else openLibrary();
  } catch (e) { notify('词库加载失败：' + e.message, 'error'); }
}
applyPreferences();
reloadLibrary();
