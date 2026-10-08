
      /* ============================================================
         4.0 内置 XLSX 读取器
         - 只读 .xlsx（Excel 2007+ / WPS 保存的 OOXML 格式）
         - 不依赖 SheetJS、不联网，纯函数实现，不接触 DOM
         - 读取 zip 里的 sharedStrings.xml + worksheets/*.xml
         ============================================================ */
      // ==== XLSX-READER:BEGIN ====
      const XLSX_READER = (function () {
        const utf8 = new TextDecoder("utf-8");

        function unescapeXml(s) {
          if (s.indexOf("&") < 0) return s;
          return s
            .replace(/&#x([0-9a-fA-F]+);/g, function (_m, h) {
              return String.fromCodePoint(parseInt(h, 16));
            })
            .replace(/&#([0-9]+);/g, function (_m, d) {
              return String.fromCodePoint(parseInt(d, 10));
            })
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, "&");
        }

        // 取出一段 XML 中所有 <t>…</t> 的文本（富文本会被拆成多段，需要拼接）
        function tagText(fragment) {
          let out = "";
          let m;
          const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
          while ((m = re.exec(fragment)) !== null) {
            out += m[1] ? unescapeXml(m[1]) : "";
          }
          return out;
        }

        // 解析 zip 目录，得到 名称 -> { method, compSize, dataStart }
        function zipEntries(u8) {
          const len = u8.length;
          const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
          let eocd = -1;
          const min = Math.max(0, len - 22 - 65535);
          for (let i = len - 22; i >= min; i--) {
            if (dv.getUint32(i, true) === 0x06054b50) {
              eocd = i;
              break;
            }
          }
          if (eocd < 0) {
            throw new Error(
              "不是有效的 .xlsx 文件（请在 Excel / WPS 里另存为 .xlsx）"
            );
          }
          const count = dv.getUint16(eocd + 10, true);
          const cdOffset = dv.getUint32(eocd + 16, true);
          const map = new Map();
          let p = cdOffset;
          for (let i = 0; i < count; i++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true);
            const compSize = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const commentLen = dv.getUint16(p + 32, true);
            const localOff = dv.getUint32(p + 42, true);
            const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
            const lNameLen = dv.getUint16(localOff + 26, true);
            const lExtraLen = dv.getUint16(localOff + 28, true);
            map.set(name, {
              method: method,
              compSize: compSize,
              localOff: localOff,
              dataStart: localOff + 30 + lNameLen + lExtraLen,
            });
            p += 46 + nameLen + extraLen + commentLen;
          }
          if (map.size === 0) throw new Error("这个文件里没有任何内容");
          // 少数写入器会把压缩后的长度写成 0，用下一个条目的位置兜底
          const list = Array.from(map.values());
          for (const entry of list) {
            if (!entry.compSize) {
              let next = cdOffset;
              for (const other of list) {
                if (other.localOff > entry.localOff && other.localOff < next) {
                  next = other.localOff;
                }
              }
              entry.compSize = next - entry.dataStart;
            }
          }
          return map;
        }

        async function readEntry(u8, entry) {
          const data = u8.subarray(
            entry.dataStart,
            entry.dataStart + entry.compSize
          );
          if (entry.method === 0) return data;
          if (entry.method !== 8) {
            throw new Error("不支持的压缩方式（method " + entry.method + "）");
          }
          if (window.Android) {
            let binary = "";
            for (let i=0; i<data.length; i++) binary += String.fromCharCode(data[i]);
            const decoded = Android.inflate(btoa(binary));
            if (!decoded) throw new Error("Excel 解压失败，请检查文件是否损坏或过大");
            const text = atob(decoded);
            return Uint8Array.from(text, c => c.charCodeAt(0));
          }
          const stream = new Blob([data])
            .stream()
            .pipeThrough(new DecompressionStream("deflate-raw"));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        }

        // "AB12" -> 27
        function colIndex(ref) {
          let n = 0;
          for (let i = 0; i < ref.length; i++) {
            const c = ref.charCodeAt(i);
            if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
            else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
            else break;
          }
          return n - 1;
        }

        function parseSharedStrings(xml) {
          const out = [];
          const re = /<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g;
          let m;
          while ((m = re.exec(xml)) !== null) out.push(m[1] ? tagText(m[1]) : "");
          return out;
        }

        function parseSheetRows(xml, shared) {
          const rows = [];
          const rowRe = /<row\b([^>]*?)\/>|<row\b([^>]*?)>([\s\S]*?)<\/row>/g;
          let rm;
          while ((rm = rowRe.exec(xml)) !== null) {
            const rowAttrs = rm[1] !== undefined ? rm[1] : rm[2];
            const body = rm[3] || "";
            const cells = [];
            let seq = 0;
            const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
            let cm;
            while ((cm = cellRe.exec(body)) !== null) {
              const attrs = cm[1] !== undefined ? cm[1] : cm[2];
              const inner = cm[3] || "";
              const rRef = /\br="([A-Za-z]+)[0-9]+"/.exec(attrs);
              const idx = rRef ? colIndex(rRef[1]) : seq;
              if (idx < 0) continue;
              seq = idx + 1;
              const tAttr = /\bt="([^"]*)"/.exec(attrs);
              const t = tAttr ? tAttr[1] : "";
              let val = "";
              if (t === "inlineStr") {
                val = tagText(inner);
              } else {
                const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
                if (vm) {
                  const raw = unescapeXml(vm[1]);
                  if (t === "s") {
                    const si = parseInt(raw, 10);
                    val = isNaN(si) || shared[si] === undefined ? "" : shared[si];
                  } else if (t === "b") {
                    val = raw === "1" ? "TRUE" : "FALSE";
                  } else if (t === "e") {
                    val = "";
                  } else {
                    val = raw;
                  }
                }
              }
              cells[idx] = val;
            }
            const rNum = /\br="([0-9]+)"/.exec(rowAttrs);
            const at = rNum ? parseInt(rNum[1], 10) - 1 : rows.length;
            if (at >= 0) rows[at] = cells;
          }
          return rows;
        }

        function parseWorkbook(xml) {
          const sheets = [];
          const re = /<sheet\b([^>]*?)\/>|<sheet\b([^>]*?)>([\s\S]*?)<\/sheet>/g;
          let m;
          while ((m = re.exec(xml)) !== null) {
            const attrs = m[1] !== undefined ? m[1] : m[2];
            const name = /\bname="([^"]*)"/.exec(attrs);
            const rid = /\br:id="([^"]*)"/.exec(attrs);
            sheets.push({
              name: name ? unescapeXml(name[1]) : "",
              rid: rid ? rid[1] : "",
            });
          }
          return sheets;
        }

        function parseRels(xml) {
          const map = {};
          const re = /<Relationship\b([^>]*?)\/?>/g;
          let m;
          while ((m = re.exec(xml)) !== null) {
            const id = /\bId="([^"]*)"/.exec(m[1]);
            const target = /\bTarget="([^"]*)"/.exec(m[1]);
            if (id && target) map[id[1]] = unescapeXml(target[1]);
          }
          return map;
        }

        function resolvePart(baseDir, target) {
          if (target.charAt(0) === "/") return target.slice(1);
          const out = [];
          const segs = (baseDir + "/" + target).split("/");
          for (const seg of segs) {
            if (!seg || seg === ".") continue;
            if (seg === "..") out.pop();
            else out.push(seg);
          }
          return out.join("/");
        }

        // 返回 [{ name: 工作表名, rows: [[单元格字符串…]…] }]
        async function read(file) {
          const u8 = new Uint8Array(await file.arrayBuffer());
          const parts = zipEntries(u8);
          async function partText(name) {
            const entry = parts.get(name);
            return entry ? utf8.decode(await readEntry(u8, entry)) : null;
          }
          const sharedXml = await partText("xl/sharedStrings.xml");
          const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
          const wbXml = await partText("xl/workbook.xml");
          const relsXml = await partText("xl/_rels/workbook.xml.rels");
          const rels = relsXml ? parseRels(relsXml) : {};
          const declared = wbXml ? parseWorkbook(wbXml) : [];
          const out = [];
          for (const sheet of declared) {
            let path =
              sheet.rid && rels[sheet.rid]
                ? resolvePart("xl", rels[sheet.rid])
                : "";
            if (!path || !parts.has(path)) {
              path = "xl/worksheets/sheet" + (out.length + 1) + ".xml";
            }
            if (!parts.has(path)) continue;
            out.push({
              name: sheet.name || "Sheet" + (out.length + 1),
              rows: parseSheetRows(await partText(path), shared),
            });
          }
          if (out.length === 0) {
            const names = Array.from(parts.keys())
              .filter(function (n) {
                return /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(n);
              })
              .sort(function (a, b) {
                return (
                  parseInt(a.match(/[0-9]+/)[0], 10) -
                  parseInt(b.match(/[0-9]+/)[0], 10)
                );
              });
            for (const name of names) {
              out.push({
                name: name.replace(/^.*\//, ""),
                rows: parseSheetRows(await partText(name), shared),
              });
            }
          }
          if (out.length === 0) throw new Error("这个文件里没有工作表");
          return out;
        }

        return { read: read };
      })();
      // ==== XLSX-READER:END ====

      // === 全局变量 ===
      let currentFileWords = []; // 当前文件的全部词条
      let displayWords = []; // 当前展示列表（受筛选 / 乱序影响）
      let currentIndex = 0;
      let isFilterActive = false;
      let currentView = "card";
      let currentFileName = "";
      let currentMode = "normal"; // 'normal', 'test-zh', 'test-de'
      let currentAudio = null; // 当前正在播放的音频实例
      let isRevealed = false; // 自测模式下是否已显示答案
      let fileMap = Object.create(null);
      let loadSequence = 0;
      let audioIndex = {
        byFull: new Map(),
        byTail: new Map(),
        byBase: new Map(),
        byStem: new Map(),
      };
      let blobUrls = new Map(); // File -> blob: URL（同一个文件只创建一次）
      let autoPlayTimer = null; // 自动朗读的延时器（切卡时要先取消）
      let lastAutoKey = null; // 上一次已自动朗读过的“卡片状态”
      let audioUnlocked = false; // 用户是否已经交互过（浏览器自动播放策略）
      const STORAGE_KEY = "german_app_memory";

      // === 统一的消息提示（替代原来只写 console / 弹 alert 的做法） ===
      const notifySeen = new Set();
      function notify(message, kind) {
        const line = kind + "|" + message;
        if (notifySeen.has(line)) return;
        notifySeen.add(line);
        const box = document.getElementById("notice");
        if (!box) return;
        const el = document.createElement("div");
        el.className = "toast toast-" + (kind || "info");
        el.textContent = message;
        el.title = "点击关闭";
        el.onclick = function () {
          el.remove();
        };
        box.appendChild(el);
        setTimeout(function () {
          el.remove();
        }, 10000);
      }

      function normPath(p) {
        return String(p || "")
          .replace(/\\/g, "/")
          .replace(/^\.\//, "")
          .trim()
          .toLowerCase()
          .normalize("NFC");
      }

      // 再宽容一层：去掉变音符号和所有非字母数字字符后的名字，
      // 用来兜住解压工具改过文件名（hängen.mp3 → hangen.mp3 / h_ngen.mp3）、
      // 或者 Unicode 规范形式不一致（NFC / NFD）的情况
      function foldName(s) {
        return String(s || "")
          .toLowerCase()
          .normalize("NFC")
          .replace(/ä/g, "a")
          .replace(/ö/g, "o")
          .replace(/ü/g, "u")
          .replace(/ß/g, "ss")
          .replace(/[^a-z0-9]/g, "");
      }

      // === 进度存储：localStorage 不可用时降级到内存，并明确告知用户 ===
      const store = (function () {
        const memory = {};
        let usable = false;
        try {
          window.localStorage.setItem("__probe__", "1");
          window.localStorage.removeItem("__probe__");
          usable = true;
        } catch (e) {
          usable = false;
        }

        function readAll() {
          try {
            const raw = usable
              ? window.localStorage.getItem(STORAGE_KEY)
              : memory[STORAGE_KEY];
            if (!raw) return {};
            const data = JSON.parse(raw);
            return data && typeof data === "object" ? data : {};
          } catch (e) {
            return {};
          }
        }

        function writeAll(data) {
          const raw = JSON.stringify(data);
          if (usable) {
            try {
              window.localStorage.setItem(STORAGE_KEY, raw);
              return true;
            } catch (e) {
              usable = false;
            }
          }
          memory[STORAGE_KEY] = raw;
          return false;
        }

        return {
          marks: function (fileName) {
            const list = readAll()[fileName];
            return Array.isArray(list) ? list : [];
          },
          setMark: function (fileName, word, isMarked) {
            const all = readAll();
            if (!Array.isArray(all[fileName])) all[fileName] = [];
            const list = all[fileName];
            const at = list.indexOf(word);
            if (isMarked && at === -1) list.push(word);
            else if (!isMarked && at !== -1) list.splice(at, 1);
            if (!writeAll(all)) {
              notify(
                "浏览器不允许保存进度（可能是隐私模式），本次星标在关闭页面后会丢失。",
                "warn"
              );
            }
          },
        };
      })();

      // === 绑定事件 ===
      document
        .getElementById("folderInput")
        .addEventListener("change", (e) => handleFiles(e.target.files));
      document
        .getElementById("fileInput")
        .addEventListener("change", (e) => handleFiles(e.target.files));

      // 浏览器要求先有用户交互才允许出声；记录一次即可
      ["pointerdown", "touchstart", "keydown"].forEach(function (type) {
        document.addEventListener(
          type,
          function () {
            audioUnlocked = true;
          },
          { once: true, passive: true }
        );
      });

      // === 音频索引：按文件夹里的真实文件建索引，用来修正路径大小写等问题 ===
      // 老师自己录的音频可能是 m4a / wav 等格式，这里一并接受
      const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac)$/i;

      function makeAudioIndex(files) {
        
        const byFull = new Map();
        const byTail = new Map();
        const byBase = new Map();
        const byStem = new Map(); // 去掉扩展名的文件名，用于跨格式匹配
        const byFold = new Map(); // 再去掉变音符号，兜住文件名被改动过的情况
        for (const file of files) {
          if (!AUDIO_EXT.test(file.name)) continue;
          const rel = normPath(file.webkitRelativePath || file.name);
          const segs = rel.split("/");
          byFull.set(rel, file);
          byTail.set(segs.slice(-2).join("/"), file);
          const base = segs[segs.length - 1];
          if (!byBase.has(base)) byBase.set(base, []);
          byBase.get(base).push(file);
          const stem = base.replace(/\.[^.]+$/, "");
          if (!byStem.has(stem)) byStem.set(stem, []);
          byStem.get(stem).push(file);
          const fold = foldName(stem);
          if (fold) {
            if (!byFold.has(fold)) byFold.set(fold, []);
            byFold.get(fold).push(file);
          }
        }
        return {
          byFull: byFull,
          byTail: byTail,
          byBase: byBase,
          byStem: byStem,
          byFold: byFold,
        };
      }

      function buildAudioIndex(files) {
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
      // 发音列留空时，用德语词条猜音频文件名（去掉 * 和 /）
      function guessAudioNames(german) {
        const g = String(german || "").trim();
        const out = [];
        function add(value) {
          const s = String(value || "").trim();
          if (!s) return;
          const name = (s + ".mp3").toLowerCase();
          if (out.indexOf(name) === -1) out.push(name);
        }
        add(g);
        add(g.replace(/\*/g, ""));
        add(g.replace(/[*/]/g, ""));
        add(g.replace(/\*/g, "").replace(/\//g, ""));
        add(g.replace(/\*/g, "").replace(/\//g, " "));
        // 德语里 "/" 有两种含义：可分动词（vor/haben，去掉斜杠才是文件名）
        // 和异体写法（gern/gerne，实际文件常只取其中一段）。后一种再补两个候选。
        const parts = g.replace(/\*/g, "").split("/");
        if (parts.length > 1) {
          add(parts[0]);
          add(parts[1]);
        }
        return out;
      }

      // 同名文件有多个时，优先选「和这个单元在同一个目录」的那个
      function pickFrom(list, word) {
        if (!list || list.length === 0) return null;
        if (list.length === 1) return list[0];
        if (word && word.unitPrefix) {
          const hit = list.find(function (f) {
            return (
              normPath(f.webkitRelativePath || f.name).indexOf(
                word.unitPrefix
              ) !== -1
            );
          });
          if (hit) return hit;
        }
        return list[0];
      }

      function pickByBase(base, word, index) {
        return pickFrom((index || audioIndex).byBase.get(base), word);
      }

      function pickByStem(stem, word, index) {
        return pickFrom((index || audioIndex).byStem.get(stem), word);
      }

      function pickByFold(name, word, index) {
        return pickFrom((index || audioIndex).byFold.get(foldName(name)), word);
      }

      function findAudioFile(word, index) {
        index = index || (word.sourceRoot && audioIndex.byRoot && audioIndex.byRoot.get(word.sourceRoot)) || audioIndex;
        const declared = normPath(word.pronounce);
        if (declared) {
          if (index.byFull.has(declared)) return index.byFull.get(declared);
          const segs = declared.split("/");
          const tail = segs.slice(-2).join("/");
          if (index.byTail.has(tail)) return index.byTail.get(tail);
          const hit = pickByBase(segs[segs.length - 1], word, index);
          if (hit) return hit;
        }
        const names = guessAudioNames(word.german);
        for (const name of names) {
          const hit = pickByBase(name, word, index);
          if (hit) return hit;
        }
        // 再按「不带扩展名的文件名」找一遍，这样 m4a / wav 录的也能认出来
        for (const name of names) {
          const hit = pickByStem(name.replace(/\.[^.]+$/, ""), word, index);
          if (hit) return hit;
        }
        // 最后按「去掉变音符号」再找一遍
        for (const name of names) {
          const hit = pickByFold(name.replace(/\.[^.]+$/, ""), word, index);
          if (hit) return hit;
        }
        return index !== audioIndex ? findAudioFile(word, audioIndex) : null;
      }

      function hasAudio(word) {
        return !!findAudioFile(word);
      }

      function audioSource(word) {
        const file = findAudioFile(word);
        if (file) {
          if (file.url) return { url: file.url, label: file.name };
          if (!blobUrls.has(file)) blobUrls.set(file, URL.createObjectURL(file));
          return { url: blobUrls.get(file), label: file.name };
        }
        // 没有拿到文件夹里的文件时，退回按相对路径播放（HTML 与 words 同级时可用）
        if (word.pronounce) {
          return { url: String(word.pronounce), label: String(word.pronounce) };
        }
        return null;
      }

      function playPronounce(word) {
        const src = audioSource(word);
        if (!src) {
          notify("「" + word.german + "」没有找到对应的音频文件", "warn");
          return;
        }
        if (currentAudio) {
          try {
            currentAudio.pause();
          } catch (e) {
            /* 忽略 */
          }
          currentAudio = null;
        }
        if (window.Android) { Android.play(new URL(src.url, location.href).href); return; }
        const audio = new Audio(src.url);
        audio.addEventListener(
          "error",
          function () {
            notify("音频加载失败：" + src.label + "（请确认 words 文件夹完整）", "error");
          },
          { once: true }
        );
        audio.addEventListener("ended", function () {
          if (currentAudio === audio) currentAudio = null;
        });
        currentAudio = audio;
        const played = audio.play();
        if (played && typeof played.catch === "function") {
          played.catch(function () {
            notify("浏览器拦截了自动播放，点一下卡片或 🔊 即可播放", "warn");
          });
        }
      }

      // === 词表列名 -> 列号（不再写死列序，老师加一列也不会坏） ===
      const COLUMN_ALIASES = [
        { key: "german", names: ["德语", "单词", "德文", "german", "wort"] },
        { key: "chinese", names: ["汉语", "中文", "释义", "意思", "chinese"] },
        { key: "type", names: ["词性", "词类", "wortart"] },
        { key: "gender", names: ["阴阳性", "冠词", "artikel", "der"] },
        { key: "plural", names: ["复数", "plural"] },
        { key: "audio", names: ["发音", "音频", "读音", "语音", "audio", "mp3"] },
        { key: "example", names: ["例句", "例", "beispiel", "example", "satz"] },
      ];
      const FALLBACK_COLUMNS = {
        german: 0,
        chinese: 1,
        type: 2,
        gender: 3,
        plural: 4,
        audio: 5,
      };

      function normHeader(value) {
        return String(value === undefined || value === null ? "" : value)
          .trim()
          .toLowerCase()
          .replace(/[\s()（）【】[\]]/g, "");
      }

      function mapColumns(rows) {
        const limit = Math.min(rows.length, 8);
        for (let i = 0; i < limit; i++) {
          const row = rows[i] || [];
          const map = {};
          let hits = 0;
          for (let c = 0; c < row.length; c++) {
            const head = normHeader(row[c]);
            if (!head) continue;
            for (const col of COLUMN_ALIASES) {
              if (
                map[col.key] === undefined &&
                col.names.some(function (n) {
                  return head.indexOf(n) !== -1;
                })
              ) {
                map[col.key] = c;
                hits++;
                break;
              }
            }
          }
          if (map.german !== undefined && hits >= 2) {
            return { headerRow: i, map: map };
          }
        }
        return null;
      }

      function cellOf(row, idx) {
        if (!row || idx === undefined || idx === null) return "";
        const value = row[idx];
        return value === undefined || value === null ? "" : String(value).trim();
      }

      // 该表里“发音”列最常见的目录，作为猜音频时的优先级提示
      function commonAudioPrefix(rows, map) {
        const tally = {};
        for (const row of rows) {
          const p = normPath(cellOf(row, map.audio));
          if (!p) continue;
          const dir = p.split("/").slice(0, -1).join("/");
          if (!dir) continue;
          tally[dir] = (tally[dir] || 0) + 1;
        }
        let best = "";
        let bestN = 0;
        for (const dir in tally) {
          if (tally[dir] > bestN) {
            bestN = tally[dir];
            best = dir;
          }
        }
        return best;
      }

      function parseSheets(sheets) {
        const words = [];
        const warnings = [];
        let used = 0;
        for (const sheet of sheets) {
          const found = mapColumns(sheet.rows);
          let map = found ? found.map : null;
          let start = found ? found.headerRow + 1 : 0;
          if (!found) {
            map = FALLBACK_COLUMNS;
            const firstRow = (sheet.rows[0] || []).join("");
            start = /德语|单词|word/i.test(firstRow) ? 1 : 0;
            warnings.push(
              "「" +
                sheet.name +
                "」没认出表头，已按默认列序（德语/汉语/词性/阴阳性/复数/发音）读取。"
            );
          }
          const unitPrefix = commonAudioPrefix(sheet.rows, map);
          let count = 0;
          for (let i = start; i < sheet.rows.length; i++) {
            const row = sheet.rows[i] || [];
            const german = cellOf(row, map.german);
            if (!german) continue;
            if (/^(德语|单词|德文|word|german)$/i.test(german)) continue;
            words.push({
              id: sheet.name + "#" + i,
              sheet: sheet.name,
              german: german,
              chinese: cellOf(row, map.chinese),
              type: cellOf(row, map.type),
              gender: cellOf(row, map.gender).toLowerCase(),
              plural: cellOf(row, map.plural),
              pronounce: cellOf(row, map.audio),
              example: cellOf(row, map.example),
              unitPrefix: unitPrefix,
              marked: false,
            });
            count++;
          }
          if (count > 0) used++;
        }
        return { words: words, sheets: used, warnings: warnings };
      }

      // === 核心逻辑 ===
      function handleFiles(files) {
        const all = Array.from(files);
        buildAudioIndex(all);

        const bookFiles = all
          .filter(function (f) {
            return /\.xlsx$/i.test(f.name);
          })
          .sort(function (a, b) {
            // 按文件名里的第一个数字排（E1…E7），没有数字的（虚词大盘点）放最后
            const na = (a.name.match(/[0-9]+/) || [Number.MAX_SAFE_INTEGER])[0];
            const nb = (b.name.match(/[0-9]+/) || [Number.MAX_SAFE_INTEGER])[0];
            if (na !== nb) return Number(na) - Number(nb);
            return a.name.localeCompare(b.name, "zh");
          });
        const legacy = all.filter(function (f) {
          return /\.xls$/i.test(f.name);
        });

        fileMap = Object.create(null);
        const fileListEl = document.getElementById("fileList");
        fileListEl.innerHTML = "";
        for (const file of bookFiles) {
          let key = file.name;
          if (fileMap[key]) key = file.name + " · " + (file.webkitRelativePath || "导入词表");
          fileMap[key] = file;
          const li = document.createElement("li");
          li.className = "file-item";
          li.textContent = key;
          li.onclick = function () {
            loadFile(key);
          };
          fileListEl.appendChild(li);
        }

        if (bookFiles.length === 0) {
          fileListEl.innerHTML =
            '<li style="padding:20px;text-align:center;color:#d32f2f;">没找到 .xlsx 词表<br>请选中包含 words 的整个文件夹</li>';
          notify(
            "没找到 .xlsx 词表。请点「导入文件夹」，选中装有 words 的那个文件夹。",
            "error"
          );
          return;
        }
        if (legacy.length) {
          notify(
            "已忽略 " +
              legacy.length +
              " 个旧版 .xls 文件：只支持 .xlsx，请在 Excel/WPS 里另存为 .xlsx。",
            "warn"
          );
        }
        // 导入结果写在侧边栏底部，不再弹提示条（每次都弹太吵）
        const statusEl = document.getElementById("sidebarStatus");
        if (statusEl) {
          statusEl.textContent =
            "已导入 " +
            bookFiles.length +
            " 个词表 · " +
            Math.max(0, all.length - bookFiles.length - legacy.length) +
            " 个音频文件";
        }
      }

      async function loadFile(fileName) {
        const sequence = ++loadSequence;
        document.querySelectorAll(".file-item").forEach(function (el) {
          el.classList.toggle("active", el.textContent === fileName);
        });
        
        try {
          const sheets = await XLSX_READER.read(fileMap[fileName]);
          if (sequence !== loadSequence) return;
          const parsed = parseSheets(sheets);
          if (parsed.words.length === 0) {
            notify(
              "「" +
                fileName +
                "」里没读到单词。请确认第一行是表头（德语 / 汉语 / 词性…）。",
              "error"
            );
            return;
          }
          currentFileName = fileName;
          processData(parsed.words);
          parsed.warnings.forEach(function (w) {
            notify(w, "warn");
          });
          return true;
        } catch (err) {
          if (sequence !== loadSequence) return;
          notify(
            "读取「" + fileName + "」失败：" + (err && err.message ? err.message : err),
            "error"
          );
        }
      }

      function processData(words) {
        currentFileWords = words;
        const source = fileMap[currentFileName];
        currentFileWords.forEach(w => w.sourceRoot = source && source.root);
        const savedMarks = store.marks(currentFileName);
        currentFileWords.forEach(function (w) {
          w.marked = savedMarks.indexOf(w.german) !== -1;
        });

        document.getElementById("emptyState").style.display = "none";
        currentIndex = 0;
        isRevealed = false;
        lastAutoKey = null;
        refreshDisplayList();
      }

      // === 列表管理（筛选与排序） ===
      // keepIndex：在“只看星标”里取消星标时不要跳回第一张
      function refreshDisplayList(keepIndex) {
        let baseList = currentFileWords.slice();

        // 筛选
        if (isFilterActive) {
          baseList = baseList.filter(function (w) {
            return w.marked;
          });
        }

        displayWords = baseList;
        currentIndex = keepIndex
          ? Math.min(currentIndex, Math.max(0, displayWords.length - 1))
          : 0;
        isRevealed = false;
        lastAutoKey = null;
        updateUI();
      }

      function shuffleCurrentList() {
        if (displayWords.length === 0) return;

        // Fisher-Yates Shuffle
        for (let i = displayWords.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = displayWords[i];
          displayWords[i] = displayWords[j];
          displayWords[j] = tmp;
        }

        currentIndex = 0;
        isRevealed = false;
        lastAutoKey = null;
        updateUI();

        const btn = document.getElementById("btnShuffle");
        const originalText = btn.innerText;
        btn.innerText = "✅ 已乱序";
        setTimeout(function () {
          btn.innerText = originalText;
        }, 1000);
      }

      // === 模式与视图 ===
      function changeMode() {
        currentMode = document.getElementById("modeSelect").value;
        isRevealed = false; // 切换模式时重置显示状态
        lastAutoKey = null;
        updateUI();
      }

      function toggleFilter() {
        isFilterActive = !isFilterActive;
        document
          .getElementById("btnFilter")
          .classList.toggle("active", isFilterActive);
        refreshDisplayList();
      }

      function switchView(view) {
        currentView = view;
        document
          .getElementById("btnCardView")
          .classList.toggle("active", view === "card");
        document
          .getElementById("btnListView")
          .classList.toggle("active", view === "list");
        updateUI();
      }

      function toggleReveal() {
        if (currentMode === "normal" || !displayWords.length) return;
        isRevealed = !isRevealed;
        renderCard(); // 需要重新渲染卡片以更新颜色
      }

      function getBgClass(word) {
        if (word.type.includes("名词")) {
          if (word.gender === "der") return "bg-der";
          if (word.gender === "die") return "bg-die";
          if (word.gender === "das") return "bg-das";
        }
        return "bg-other";
      }

      // 翻页按钮的可用状态
      function updateNav() {
        const prev = document.getElementById("btnPrevCard");
        const next = document.getElementById("btnNextCard");
        if (!prev || !next) return;
        prev.disabled = currentIndex <= 0;
        next.disabled =
          displayWords.length === 0 || currentIndex >= displayWords.length - 1;
      }

      function updateUI() {
        const markedCount = currentFileWords.filter((w) => w.marked).length;
        document.getElementById(
          "btnFilter"
        ).innerText = `只看星标 (${markedCount})`;

        const cardCont = document.getElementById("cardViewContainer");
        const listCont = document.getElementById("listViewContainer");
        const emptyEl = document.getElementById("emptyState");

        if (displayWords.length === 0) {
          if (isFilterActive && currentFileWords.length > 0) {
            cardCont.style.display = currentView === "card" ? "flex" : "none";
            listCont.style.display = currentView === "list" ? "flex" : "none";
            renderEmptyView();
          } else {
            cardCont.style.display = "none";
            listCont.style.display = "none";
            emptyEl.style.display = "flex";
          }
          updateNav();
          return;
        }

        if (currentView === "card") {
          cardCont.style.display = "flex";
          listCont.style.display = "none";
          renderCard();
        } else {
          cardCont.style.display = "none";
          listCont.style.display = "flex";
          renderList();
        }
        updateNav();
      }

      function renderEmptyView() {
        if (currentView === "card") {
          const cardEl = document.getElementById("cardView");
          cardEl.className = "card bg-other";
          document.getElementById("cardGerman").innerText = "没有星标单词";
          document.getElementById("chineseArea").style.visibility = "hidden";
          document.getElementById("metaArea").style.visibility = "hidden";
          document.getElementById("cardIndexInfo").innerText = "";
          document.getElementById("pronounceIcon").style.display = "none";
          document.getElementById("exampleArea").style.display = "none";
          cardEl.classList.remove("marked");
        } else {
          const cols = document.querySelectorAll("#wordTable thead th").length || 5;
          document.querySelector("#wordTable tbody").innerHTML =
            '<tr><td colspan="' +
            cols +
            '" style="text-align:center;padding:30px;color:#999;">没有星标单词</td></tr>';
        }
      }

      function renderCard() {
        const word = displayWords[currentIndex];
        if (!word) return;
        const cardEl = document.getElementById("cardView");

        // 1. 设置背景色 (核心修改逻辑)
        // 如果不是普通模式，且答案未揭晓，强制使用白色背景 (bg-other)
        let bgClass = getBgClass(word);
        if (currentMode !== "normal" && !isRevealed) {
          bgClass = "bg-other";
        }

        cardEl.className = `card ${bgClass}`;
        if (word.marked) cardEl.classList.add("marked");
        else cardEl.classList.remove("marked");

        // 2. 填充内容
        const germanEl = document.getElementById("cardGerman");
        if (
          word.type.includes("名词") &&
          ["der", "die", "das"].includes(word.gender)
        ) {
          germanEl.innerHTML = `<span class="article-hint">${word.gender}</span>`;
          germanEl.appendChild(document.createTextNode(word.german));
        } else {
          germanEl.textContent = word.german;
        }
        document.getElementById("cardChinese").innerText = word.chinese;

        document.getElementById("cardType").innerText = word.type;
        const genderEl = document.getElementById("cardGender");
        if (word.type.includes("名词") && word.gender) {
          genderEl.innerText = word.gender.toUpperCase();
          genderEl.style.display = "inline-block";
        } else {
          genderEl.style.display = "none";
        }
        document.getElementById("cardPlural").innerText =
          word.type.includes("名词") && word.plural
            ? `Plural: ${word.plural}`
            : "";

        // 例句：没有例句就整块收起，不留空白
        const exampleArea = document.getElementById("exampleArea");
        if (word.example) {
          document.getElementById("cardExample").innerText = word.example;
          exampleArea.style.display = "";
        } else {
          document.getElementById("cardExample").innerText = "";
          exampleArea.style.display = "none";
        }

        // 3. 自测模式显隐逻辑
        const germanArea = document.getElementById("germanArea");
        const chineseArea = document.getElementById("chineseArea");
        const metaArea = document.getElementById("metaArea");
        const hintText = document.getElementById("clickHint");

        // 默认全部显示
        germanArea.classList.remove("hidden-content");
        chineseArea.classList.remove("hidden-content");
        metaArea.classList.remove("hidden-content");
        exampleArea.classList.remove("hidden-content");
        chineseArea.style.visibility = "";
        metaArea.style.visibility = "";
        hintText.style.opacity = "0";

        // 例句在自测模式下必须等揭晓后才出现（例句里通常就有这个词）
        if (currentMode !== "normal" && !isRevealed && word.example) {
          exampleArea.classList.add("hidden-content");
        }

        if (currentMode === "test-zh") {
          // 中文自测：一开始只显示中文
          if (!isRevealed) {
            germanArea.classList.add("hidden-content");
            metaArea.classList.add("hidden-content");
            hintText.style.opacity = "1";
          }
        } else if (currentMode === "test-de") {
          // 德语自测：一开始只显示德语（隐藏中文）
          if (!isRevealed) {
            chineseArea.classList.add("hidden-content");
            hintText.style.opacity = "1";
          }
        }

        // ===== 发音功能 =====
        const pronounceIcon = document.getElementById("pronounceIcon");
        if (hasAudio(word)) {
          pronounceIcon.style.display = "inline";
          pronounceIcon.onclick = function (e) {
            e.stopPropagation(); // 阻止卡片整体的 toggleReveal 事件
            playPronounce(word);
          };
        } else {
          pronounceIcon.style.display = "none";
          pronounceIcon.onclick = null;
        }

        // ===== 自动朗读 =====
        // 4.0 修正：原来每次重绘都延时播放，导致快速翻卡时播出“上一张”的词、
        // 按 Q 揭晓答案时重复播放。现在只在“德语可见”且内容确实变化时播一次。
        if (autoPlayTimer) {
          clearTimeout(autoPlayTimer);
          autoPlayTimer = null;
        }
        const germanVisible =
          currentMode === "normal" || currentMode === "test-de" || isRevealed;
        pronounceIcon.style.display = germanVisible && hasAudio(word) ? "inline-flex" : "none";
        const autoKey =
          currentFileName +
          "#" +
          word.id +
          "#" +
          currentMode +
          "#" +
          (isRevealed ? "r" : "h");
        if (autoPlayEnabled && germanVisible && hasAudio(word) && autoKey !== lastAutoKey) {
          lastAutoKey = autoKey;
          if (audioUnlocked) {
            autoPlayTimer = setTimeout(function () {
              autoPlayTimer = null;
              playPronounce(word);
            }, 120);
          }
        }

        document.getElementById("cardIndexInfo").innerText = `${
          currentIndex + 1
        } / ${displayWords.length}`;
        updateNav();
      }

      function renderList() {
        const tbody = document.querySelector("#wordTable tbody");
        tbody.innerHTML = "";

        displayWords.forEach(function (word) {
          const tr = document.createElement("tr");
          tr.className = getBgClass(word);
          if (word.marked) tr.classList.add("marked");

          const displayG =
            word.type.includes("名词") &&
            ["der", "die", "das"].includes(word.gender)
              ? word.gender + " " + word.german
              : word.german;

          // 逐格用 textContent 填充：词条里出现 < > & 也不会把表格结构弄坏
          [
            displayG,
            word.chinese,
            word.type,
            word.plural || "",
            word.example || "",
          ].forEach(
            function (text) {
              const td = document.createElement("td");
              td.textContent = text;
              tr.appendChild(td);
            }
          );

          // 单独处理发音单元格
          const tdPronounce = document.createElement("td");
          tdPronounce.className = "pronounce-cell";
          if (hasAudio(word)) {
            const icon = document.createElement("span");
            icon.textContent = "🔊";
            icon.style.cursor = "pointer";
            icon.onclick = function (e) {
              e.stopPropagation(); // 避免触发行点击事件
              playPronounce(word);
            };
            tdPronounce.appendChild(icon);
          } else {
            // 没有音频时给个明确标记，免得"空着"看不出是缺文件还是没加载
            const none = document.createElement("span");
            none.textContent = "🔇";
            none.title = "没有找到这个词的音频文件";
            none.style.opacity = "0.45";
            none.style.cursor = "help";
            tdPronounce.appendChild(none);
          }
          tr.appendChild(tdPronounce);

          // 星标操作
          tr.onclick = function () {
            toggleMark(word);
          };
          tbody.appendChild(tr);
        });
      }

      // === 交互操作 ===
      function nextCard() {
        if (currentIndex < displayWords.length - 1) {
          currentIndex++;
          isRevealed = false;
          renderCard();
        }
      }

      function prevCard() {
        if (currentIndex > 0) {
          currentIndex--;
          isRevealed = false;
          renderCard();
        }
      }

      function toggleCurrentMark() {
        if (displayWords.length > 0) toggleMark(displayWords[currentIndex]);
      }

      function toggleMark(wordObj) {
        wordObj.marked = !wordObj.marked;

        const original = currentFileWords.find(function (w) {
          return w.id === wordObj.id;
        });
        if (original) original.marked = wordObj.marked;

        store.setMark(currentFileName, wordObj.german, wordObj.marked);

        if (isFilterActive && !wordObj.marked) {
          refreshDisplayList(true);
        } else {
          updateUI();
        }
      }

      // === 键盘事件 ===
      document.addEventListener("keydown", function (e) {
        if (displayWords.length === 0) return;

        // 焦点在输入控件里时不抢按键
        const tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

        const key = String(e.key || "").toLowerCase();

        if (key === "4") {
          nextCard();
        } else if (key === "2") {
          prevCard();
        } else if (key === "arrowright" && currentView === "card") {
          e.preventDefault();
          nextCard();
        } else if (key === "arrowleft" && currentView === "card") {
          e.preventDefault();
          prevCard();
        } else if (key === "q") {
          toggleReveal();
        } else if (e.code === "Space") {
          e.preventDefault();
          toggleCurrentMark();
        }
      });
    