import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web=path.join(root,'app/src/main/assets/web');
const storage=new Map();
class Element {
  constructor(){this.style={};this.dataset={};this.attributes={};this.children=[];this.textContent='';this.innerText='';this.className='';this.value='normal';this.scrollTop=0;const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};}
  addEventListener(){} appendChild(el){this.children.push(el);return el;} remove(){} setAttribute(k,v){this.attributes[k]=v;}
  set innerHTML(value){this.children=[];this.html=value;} get innerHTML(){return this.html;}
}
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const document={getElementById:get,addEventListener(){},createElement:()=>new Element(),createTextNode:text=>({textContent:text}),querySelector:selector=>get(selector),querySelectorAll:selector=>selector==='.file-item'?get('fileList').children:[]};
const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,v)=>storage.set(key,v),removeItem:key=>storage.delete(key)};
let timerId=0;const timers=new Map();
const context=vm.createContext({console,TextDecoder,Uint8Array,DataView,Blob,Response,DecompressionStream,Map,Set,URL,Number,document,
  localStorage,location:{href:'https://appassets.androidplatform.net/assets/web/index.html'},
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
  Android:{inflate:s=>inflateRawSync(Buffer.from(s,'base64')).toString('base64'),play(){},stopAudio(){}},
  window:{localStorage,Android:true}
});
vm.runInContext(fs.readFileSync(path.join(web,'engine.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(web,'mobile.js'),'utf8').replace(/reloadLibrary\(\);\s*$/, ''),context);
vm.runInContext('autoPlayEnabled=false;',context);
const files=JSON.parse(fs.readFileSync(path.join(web,'manifest.json'),'utf8')).map(item=>({name:item.name,root:'built-in',webkitRelativePath:item.path,url:item.url,arrayBuffer:async()=>{const b=fs.readFileSync(path.join(web,item.path));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}}));
context.files=files;
vm.runInContext('handleFiles(files)',context);
let total=0, audio=0;
for(const file of files.filter(f=>f.name.endsWith('.xlsx'))){
  context.book=file.name;
  await vm.runInContext('loadFile(book)',context);
  const result=vm.runInContext('({count:currentFileWords.length,audio:currentFileWords.filter(w=>findAudioFile(w)).length,first:currentFileWords[0].german})',context);
  assert.ok(result.count>0,file.name);
  total+=result.count;audio+=result.audio;
  console.log(`${file.name}: ${result.count} words, ${result.audio} matching recordings`);
}
await vm.runInContext('loadFile("E1_单词汇总.xlsx")',context);
vm.runInContext('toggleCurrentMark();toggleFilter()',context);
assert.equal(vm.runInContext('displayWords.length',context),1);
vm.runInContext('toggleCurrentMark();toggleReveal()',context);
assert.equal(vm.runInContext('displayWords.length',context),0);
vm.runInContext('toggleFilter();nextCard()',context);
assert.equal(vm.runInContext('currentIndex',context),1);
vm.runInContext('prevCard();document.getElementById("modeSelect").value="test-zh";changeMode()',context);
assert.equal(get('pronounceIcon').style.display,'none');
vm.runInContext('toggleReveal()',context);
assert.equal(get('pronounceIcon').style.display,'inline-flex');
const before=vm.runInContext('displayWords.map(w=>w.id).sort().join("|")',context);
vm.runInContext('shuffleCurrentList()',context);
assert.equal(vm.runInContext('displayWords.map(w=>w.id).sort().join("|")',context),before);
assert.equal(vm.runInContext('isShuffled',context),true);
assert.equal(get('btnShuffle').textContent,'恢复顺序');
const shuffled=vm.runInContext('orderedWords.map(w=>w.id).join("|")',context);
vm.runInContext('toggleFilter()',context);
assert.equal(vm.runInContext('displayWords.length',context),0);
assert.equal(vm.runInContext('preferences.books[currentFileName].order.length',context),65);
vm.runInContext('toggleFilter()',context);
assert.equal(vm.runInContext('displayWords.map(w=>w.id).join("|")',context),shuffled);
await vm.runInContext('loadFile(currentFileName)',context);
assert.equal(vm.runInContext('displayWords.map(w=>w.id).join("|")',context),shuffled);
vm.runInContext('shuffleCurrentList()',context);
assert.equal(vm.runInContext('isShuffled',context),false);
assert.equal(vm.runInContext('displayWords.map(w=>w.id).join("|")===currentFileWords.map(w=>w.id).join("|")',context),true);
assert.equal(get('btnShuffle').textContent,'乱序');
vm.runInContext('switchView("list"); document.getElementById("modeSelect").value="test-zh";changeMode()',context);
let row=get('#wordTable tbody').children[0];
assert.equal(row.children[0].textContent,'');
assert.equal(row.children[2].textContent,'');
assert.equal(row.children[5].children.length,1);
row.children[5].children[0].onclick({stopPropagation(){}});
assert.equal(get('#wordTable tbody').children[0].children[0].textContent,'');
get('#wordTable tbody').children[0].onclick();
assert.ok(get('#wordTable tbody').children[0].children[0].textContent);
assert.equal(get('#wordTable tbody').children[1].children[0].textContent,'');
vm.runInContext('document.getElementById("modeSelect").value="test-de";changeMode()',context);
assert.equal(get('#wordTable tbody').children[0].children[1].textContent,'');
get('#wordTable tbody').children[0].onclick();
assert.ok(get('#wordTable tbody').children[0].children[1].textContent);
vm.runInContext('switchView("card");document.getElementById("modeSelect").value="normal";changeMode();autoPlayEnabled=true;lastAutoKey=null;updateUI()',context);
const pending=vm.runInContext('autoPlayTimer',context);
assert.ok(timers.has(pending));
vm.runInContext('toggleCurrentMark()',context);
assert.equal(vm.runInContext('autoPlayTimer',context),pending,'star repaint preserves automatic playback');
vm.runInContext('playPronounce(displayWords[0])',context);
assert.ok(!timers.has(pending),'manual audio cancels pending automatic playback');
vm.runInContext('autoPlayEnabled=false; preferences=normalizePreferences({books:[]});saveStudy()',context);
assert.equal(vm.runInContext('Array.isArray(preferences.books)',context),false);
// A failed/obsolete asynchronous selection must leave the successful book intact.
const validName=vm.runInContext('currentFileName',context);
context.resolveSlow=null;
vm.runInContext('fileMap["slow.xlsx"]={arrayBuffer:()=>new Promise(resolve=>resolveSlow=resolve)};fileMap["broken.xlsx"]={arrayBuffer:async()=>new ArrayBuffer(0)}',context);
const slow=vm.runInContext('loadFile("slow.xlsx")',context);
await vm.runInContext('loadFile("E2_单词汇总.xlsx")',context);
vm.runInContext('resolveSlow(new ArrayBuffer(0))',context);await slow;
assert.equal(vm.runInContext('currentFileName',context),'E2_单词汇总.xlsx');
await vm.runInContext('loadFile("broken.xlsx")',context);
assert.equal(vm.runInContext('currentFileName',context),'E2_单词汇总.xlsx');
context.validName=validName;await vm.runInContext('loadFile(validName)',context);
// Unicode matching and literal text are shared with the original browser engine.
assert.equal(vm.runInContext('foldName("ÄÖÜß")',context),'aouss');
context.sheets=[{name:'Extra',rows:[['中文','德语','例句','词性'],['文本','<b>test</b>','A & B','动词']]}];
assert.equal(vm.runInContext('parseSheets(sheets).words[0].german',context),'<b>test</b>');
context.importedAudio={name:'lernen.mp3',root:'import-test',webkitRelativePath:'import-test/einheit1/lernen.mp3',url:'/library/import-test/einheit1/lernen.mp3'};
vm.runInContext('buildAudioIndex([...files,importedAudio])',context);
assert.equal(vm.runInContext('findAudioFile({german:"lernen",pronounce:"words/einheit1/lernen.mp3",sourceRoot:"import-test"}).url',context),context.importedAudio.url);
assert.equal(vm.runInContext('findAudioFile({german:"lernen",pronounce:"words/einheit1/lernen.mp3",sourceRoot:"built-in"}).url',context),'/assets/web/words/einheit1/lernen.mp3');
console.log(`PASS: ${total} words, ${audio} recordings; reversible shuffle, filtered/resumed order, list self-tests, audio timers, failed/obsolete loads, preferences, native inflate, navigation, marks and column aliases.`);
