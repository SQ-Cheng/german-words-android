(async function () {
  const oldMarks=localStorage.getItem(STORAGE_KEY), oldPrefs=localStorage.getItem(PREF_KEY);
  let report='';
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  try {
    autoPlayEnabled=false;
    pauseStudyAudio();
    isFilterActive=false;
    const names=Object.keys(fileMap).filter(n=>!fileMap[n].imported);
    assert(names.length===8,'eight bundled books');
    let total=0,audio=0;
    for(const name of names) {
      await loadFile(name);
      assert(currentFileWords.length>0,'parse '+name);
      total+=currentFileWords.length;
      audio+=currentFileWords.filter(w=>findAudioFile(w)).length;
    }
    assert(total===460 && audio===460,'all 460 words and recordings');
    await loadFile(names[0]);
    localStorage.setItem(STORAGE_KEY,'{}');
    currentFileWords.forEach(w=>w.marked=false);
    currentIndex=0;
    toggleCurrentMark();
    assert(store.marks(currentFileName).includes(displayWords[0].german),'mark persisted');
    toggleFilter();
    assert(displayWords.length===1,'star filter');
    toggleCurrentMark();
    assert(displayWords.length===0,'remove final star');
    toggleReveal();
    toggleFilter();
    nextCard();assert(currentIndex===1,'next');
    const resumeId=displayWords[1].id;
    const resumeName=currentFileName;
    await loadFile(names[1]);await loadFile(resumeName);
    assert(displayWords[currentIndex].id===resumeId,'resume per book');
    prevCard();assert(currentIndex===0,'previous');
    document.getElementById('modeSelect').value='test-zh';changeMode();
    assert(document.getElementById('germanArea').classList.contains('hidden-content'),'hide German');
    assert(document.getElementById('pronounceIcon').style.display==='none','no pronunciation spoiler');
    toggleReveal();
    assert(!document.getElementById('germanArea').classList.contains('hidden-content'),'reveal German');
    document.getElementById('modeSelect').value='test-de';changeMode();
    assert(document.getElementById('chineseArea').classList.contains('hidden-content'),'hide Chinese');
    toggleReveal();assert(!document.getElementById('chineseArea').classList.contains('hidden-content'),'reveal Chinese');
    document.getElementById('modeSelect').value='normal';changeMode();
    const before=displayWords.map(w=>w.id).sort().join('|');shuffleCurrentList();
    assert(before===displayWords.map(w=>w.id).sort().join('|'),'shuffle preserves words');
    switchView('list');assert(document.querySelectorAll('#wordTable tbody tr').length===65,'list rows');
    document.querySelector('#wordTable tbody tr').click();
    assert(currentFileWords.filter(w=>w.marked).length===1,'list star tap');
    switchView('card');
    openLibrary();assert(handleAndroidBack()===true && !libraryOpen,'back closes drawer');
    assert(document.documentElement.scrollWidth<=window.innerWidth+1,'no horizontal overflow');
    const next=document.getElementById('btnNextCard').getBoundingClientRect();
    assert(next.width>=44 && next.height>=44 && next.right<=innerWidth && next.bottom<=innerHeight,'visible touch controls');
    const example=parseSheets([{name:'Safe',rows:[['德语','中文','词性','例句'],['<b>literal</b>','字面','动词','A & B']]}]).words[0];
    processData([example]);
    assert(document.getElementById('cardGerman').textContent==='<b>literal</b>','literal imported text');
    assert(document.getElementById('cardExample').innerText==='A & B','examples');
    report='PASS: 460 words / 460 matching recordings; real Java inflate, three modes, audio hiding, stars, empty filter, navigation, per-book resume, shuffle, list, back, literal text and portrait layout.';
  } catch(e) { report='FAIL: '+e.stack; }
  finally {
    pauseStudyAudio();
    if(oldMarks===null)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,oldMarks);
    if(oldPrefs===null)localStorage.removeItem(PREF_KEY);else localStorage.setItem(PREF_KEY,oldPrefs);
    preferences=JSON.parse(oldPrefs||'{}');applyPreferences();await reloadLibrary();
    document.getElementById('notice').innerHTML='';
    window.smokeResult=report;
  }
})();
