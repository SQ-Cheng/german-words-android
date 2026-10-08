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
  constructor(){this.style={};this.children=[];this.textContent='';this.innerText='';this.className='';this.value='normal';this.classList={add(){},remove(){},toggle(){}};}
  addEventListener(){} appendChild(el){this.children.push(el);return el;} remove(){} setAttribute(){}
  set innerHTML(value){this.children=[];this.html=value;} get innerHTML(){return this.html;}
}
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const document={getElementById:get,addEventListener(){},createElement:()=>new Element(),createTextNode:text=>({textContent:text}),querySelector:selector=>get(selector),querySelectorAll:()=>[]};
const context=vm.createContext({console,TextDecoder,Uint8Array,DataView,Blob,Response,DecompressionStream,Map,Set,URL,Number,document,
  setTimeout:()=>0,clearTimeout(){},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
  Android:{inflate:s=>inflateRawSync(Buffer.from(s,'base64')).toString('base64'),play(){}},
  window:{localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,v)=>storage.set(key,v),removeItem:key=>storage.delete(key)},Android:true}
});
vm.runInContext(fs.readFileSync(path.join(web,'engine.js'),'utf8')+'\nlet autoPlayEnabled=false;',context);
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
// Unicode matching and literal text are shared with the original browser engine.
assert.equal(vm.runInContext('foldName("ÄÖÜß")',context),'aouss');
context.sheets=[{name:'Extra',rows:[['中文','德语','例句','词性'],['文本','<b>test</b>','A & B','动词']]}];
assert.equal(vm.runInContext('parseSheets(sheets).words[0].german',context),'<b>test</b>');
context.importedAudio={name:'lernen.mp3',root:'import-test',webkitRelativePath:'import-test/einheit1/lernen.mp3',url:'/library/import-test/einheit1/lernen.mp3'};
vm.runInContext('buildAudioIndex([...files,importedAudio])',context);
assert.equal(vm.runInContext('findAudioFile({german:"lernen",pronounce:"words/einheit1/lernen.mp3",sourceRoot:"import-test"}).url',context),context.importedAudio.url);
assert.equal(vm.runInContext('findAudioFile({german:"lernen",pronounce:"words/einheit1/lernen.mp3",sourceRoot:"built-in"}).url',context),'/assets/web/words/einheit1/lernen.mp3');
console.log(`PASS: ${total} words, ${audio} recordings; native inflate, modes, navigation, shuffle, marks, empty filter, column aliases.`);
