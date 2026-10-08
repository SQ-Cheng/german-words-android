"""Rebuild the Android HTML from the original 4.0 learning engine; original stays untouched."""
from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[1]
web = ROOT / 'app/src/main/assets/web'
source = (ROOT.parent / '德语单词记忆助手4.0/De_words_helper.html').read_text(encoding='utf-8')
engine = re.search(r'<script>([\s\S]*?)</script>', source).group(1)
engine = engine.replace('const stream = new Blob([data])', '''if (window.Android) {
            let binary = "";
            for (let i=0; i<data.length; i++) binary += String.fromCharCode(data[i]);
            const decoded = Android.inflate(btoa(binary));
            if (!decoded) throw new Error("Excel 解压失败，请检查文件是否损坏或过大");
            const text = atob(decoded);
            return Uint8Array.from(text, c => c.charCodeAt(0));
          }
          const stream = new Blob([data])''')
engine = engine.replace('if (!blobUrls.has(file))', 'if (file.url) return { url: file.url, label: file.name };\n          if (!blobUrls.has(file))')
# Keep identical filenames in different import sessions attached to their own recordings.
begin = engine.index('function buildAudioIndex(files) {')
end = engine.index('// 发音列留空时', begin)
builder = engine[begin:end].replace('function buildAudioIndex(files)', 'function makeAudioIndex(files)')
builder = builder.replace('for (const url of blobUrls.values()) URL.revokeObjectURL(url);\n        blobUrls = new Map();', '')
builder = builder.replace('audioIndex = {', 'return {')
engine = engine[:begin] + builder + '''function buildAudioIndex(files) {
        for (const url of blobUrls.values()) URL.revokeObjectURL(url);
        blobUrls = new Map();
        audioIndex = makeAudioIndex(files);
        audioIndex.byRoot = new Map();
        const groups = new Map();
        for (const file of files) if (file.root) {
          if (!groups.has(file.root)) groups.set(file.root, []);
          groups.get(file.root).push(file);
        }
        for (const [root, members] of groups) audioIndex.byRoot.set(root, makeAudioIndex(members));
      }
      ''' + engine[end:]
engine = engine.replace('function pickByBase(base, word)', 'function pickByBase(base, word, index)')
engine = engine.replace('function pickByStem(stem, word)', 'function pickByStem(stem, word, index)')
engine = engine.replace('function pickByFold(name, word)', 'function pickByFold(name, word, index)')
engine = engine.replace('pickFrom(audioIndex.', 'pickFrom((index || audioIndex).')
begin = engine.index('function findAudioFile(word) {')
end = engine.index('function hasAudio(word)', begin)
finder = engine[begin:end].replace('function findAudioFile(word) {', '''function findAudioFile(word, index) {
        index = index || (word.sourceRoot && audioIndex.byRoot && audioIndex.byRoot.get(word.sourceRoot)) || audioIndex;''')
finder = finder.replace('audioIndex.byFull', 'index.byFull').replace('audioIndex.byTail', 'index.byTail')
finder = finder.replace('segs[segs.length - 1], word)', 'segs[segs.length - 1], word, index)')
finder = finder.replace('pickByBase(name, word)', 'pickByBase(name, word, index)')
finder = finder.replace('""), word)', '""), word, index)').replace('pickByFold(name, word)', 'pickByFold(name, word, index)')
finder = finder.replace('return null;', 'return index !== audioIndex ? findAudioFile(word, audioIndex) : null;')
engine = engine[:begin] + finder + engine[end:]
engine = engine.replace('currentFileWords = words;', 'currentFileWords = words;\n        const source = fileMap[currentFileName];\n        currentFileWords.forEach(w => w.sourceRoot = source && source.root);')
engine = engine.replace('const audio = new Audio(src.url);', '''if (window.Android) { Android.play(new URL(src.url, location.href).href); return; }
        const audio = new Audio(src.url);''')
engine = engine.replace('function hasAudio(word) {\n        return !!(word.pronounce || findAudioFile(word));', 'function hasAudio(word) {\n        return !!findAudioFile(word);')
engine = engine.replace('let fileMap = {};', 'let fileMap = {};\n      let loadSequence = 0;')
engine = engine.replace('fileMap = {};', 'fileMap = Object.create(null);')
engine = engine.replace('fileMap[file.name] = file;', '''let key = file.name;
          if (fileMap[key]) key = file.name + " · " + (file.webkitRelativePath || "导入词表");
          fileMap[key] = file;''')
engine = engine.replace('li.textContent = file.name;', 'li.textContent = key;')
engine = engine.replace('loadFile(file.name);', 'loadFile(key);')
engine = engine.replace('async function loadFile(fileName) {', 'async function loadFile(fileName) {\n        const sequence = ++loadSequence;')
engine = engine.replace('currentFileName = fileName;', '')
engine = engine.replace('const parsed = parseSheets(sheets);', 'if (sequence !== loadSequence) return;\n          const parsed = parseSheets(sheets);')
engine = engine.replace('processData(parsed.words);', 'currentFileName = fileName;\n          processData(parsed.words);')
engine = engine.replace('notify(w, "warn");\n          });', 'notify(w, "warn");\n          });\n          return true;')
engine = engine.replace('} catch (err) {\n          notify(', '} catch (err) {\n          if (sequence !== loadSequence) return;\n          notify(')
engine = engine.replace('if (currentMode === "normal") return;', 'if (currentMode === "normal" || !displayWords.length) return;')
engine = engine.replace('const word = displayWords[currentIndex];\n        const cardEl', 'const word = displayWords[currentIndex];\n        if (!word) return;\n        const cardEl')
engine = engine.replace('if (germanVisible && hasAudio(word)', 'if (autoPlayEnabled && germanVisible && hasAudio(word)')
engine = engine.replace('currentMode === "normal" || currentMode === "test-de" || isRevealed;', 'currentMode === "normal" || currentMode === "test-de" || isRevealed;\n        pronounceIcon.style.display = germanVisible && hasAudio(word) ? "inline-flex" : "none";')
engine = engine.replace('hintText.style.opacity = "0";', '''chineseArea.style.visibility = "";
        metaArea.style.visibility = "";
        hintText.style.opacity = "0";''')
engine = engine.replace('"点击卡片或按 Q 显示答案"', '"轻点卡片，查看答案"')
(web / 'engine.js').write_text(engine, encoding='utf-8')
entries=[]
for path in sorted((web/'words').rglob('*')):
    if path.is_file():
        rel=path.relative_to(web).as_posix()
        entries.append({'name':path.name,'path':rel,'url':'/assets/web/'+rel})
(web/'manifest.json').write_text(json.dumps(entries, ensure_ascii=False), encoding='utf-8')
(web/'index.html').write_text('''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>德语单词</title><link rel="stylesheet" href="mobile.css"></head><body>
<header class="app-header"><div class="brand"><span class="brand-icon">W</span><div><span class="eyebrow">DEUTSCH · 每天一点进步</span><h1>德语单词</h1></div></div><button class="icon-btn" id="libraryButton" onclick="openLibrary()" aria-label="打开词库">☰</button></header>
<div id="scrim" onclick="closeLibrary()"></div>
<aside class="sidebar" id="library"><div class="drawer-heading"><div><span class="eyebrow">MEINE WÖRTER</span><h2>我的词库</h2></div><button class="icon-btn" onclick="closeLibrary()" aria-label="关闭词库">×</button></div>
<p class="sidebar-desc">内置课程词表，离线随时学习</p>
<div class="btn-group"><button class="upload-btn" onclick="Android.importFolder()">＋ 导入文件夹</button><button class="upload-btn secondary" onclick="Android.importFiles()">导入 Excel / 音频 / 备份</button></div>
<input type="file" id="folderInput" multiple hidden><input type="file" id="fileInput" multiple accept=".xlsx" hidden>
<ul id="fileList" class="file-list"></ul><div id="sidebarStatus" class="sidebar-status"></div>
<div class="library-footer"><button onclick="exportStudyBackup()">备份学习进度</button><p>外接键盘：← / → 翻页 · Q 答案 · 空格星标</p><small>Android 1.0 · 课程与音频保存在本机</small></div></aside>
<main class="main-content"><div class="lesson-heading"><div><span class="eyebrow">今天也和德语见一面</span><h2 id="lessonTitle">准备开始学习</h2></div><span id="lessonCount" class="count-badge">词库</span></div>
<div class="top-bar"><select id="modeSelect" class="mode-select" onchange="changeMode()" aria-label="学习模式"><option value="normal">普通学习</option><option value="test-zh">看中文 · 想德语</option><option value="test-de">看德语 · 想中文</option></select><div class="view-switch"><button id="btnCardView" class="active" onclick="switchView('card')">卡片</button><button id="btnListView" onclick="switchView('list')">列表</button></div></div>
<div class="study-tools"><button id="btnShuffle" onclick="shuffleCurrentList()">⇄ 乱序</button><button id="btnFilter" onclick="toggleFilter()">只看星标 (0)</button><button id="autoPlayButton" onclick="toggleAutoPlay()" aria-pressed="true">自动发音 · 开</button></div>
<div id="app-container"><div id="cardViewContainer" class="card-wrapper" style="display:none"><div id="cardView" class="card bg-other" onclick="toggleReveal()"><div class="card-topline"><span class="card-label">WORTSCHATZ</span><button class="star-mark" onclick="event.stopPropagation();toggleCurrentMark()" aria-label="星标单词">☆</button></div>
<div id="germanArea" class="card-content-area"><div id="cardGerman" class="card-german">Willkommen</div></div><button id="pronounceIcon" class="pronounce-icon" aria-label="播放发音" style="display:none">♪</button>
<div id="chineseArea" class="card-content-area"><div id="cardChinese" class="card-chinese"></div></div>
<div id="metaArea" class="card-content-area"><div class="card-tags"><span id="cardType" class="tag"></span><span id="cardGender" class="tag" style="display:none"></span></div><div id="cardPlural" class="card-plural"></div></div>
<div id="exampleArea" class="card-content-area"><div id="cardExample" class="card-example"></div></div><div id="clickHint" class="hint-text">轻点卡片，查看答案</div><div id="cardIndexInfo" class="counter-info"></div></div>
<div class="card-navigation"><button id="btnPrevCard" class="nav-btn" onclick="prevCard()" aria-label="上一个">← 上一个</button><span class="swipe-hint">左右滑动翻页</span><button id="btnNextCard" class="nav-btn primary" onclick="nextCard()" aria-label="下一个">下一个 →</button></div></div>
<div id="listViewContainer" class="list-view-container" style="display:none"><p class="list-tip">轻点词条切换星标，点 ♪ 听发音</p><div class="table-scroll"><table id="wordTable"><thead><tr><th>德语</th><th>中文</th><th>词性</th><th>复数</th><th>例句</th><th>发音</th></tr></thead><tbody></tbody></table></div></div>
<div id="emptyState" class="empty-state"><span class="empty-icon">W</span><h3>你的德语旅程，从一个词开始</h3><p>打开词库选择课程，也可以导入自己的 Excel 词表。</p><button class="upload-btn" onclick="openLibrary()">打开我的词库</button></div></div>
<footer class="study-footer"><span id="studyStatus">离线学习 · 进度自动保存</span><div class="progress-track"><div id="studyProgress"></div></div></footer></main><div id="notice" class="notice" aria-live="polite"></div>
<script src="engine.js"></script><script src="mobile.js"></script></body></html>''', encoding='utf-8')
print(f'Prepared {len(entries)} bundled files')
