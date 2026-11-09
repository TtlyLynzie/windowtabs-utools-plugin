'use strict';
(() => {
  const $ = id => document.getElementById(id), M = window.SettingsModel, api = window.windowTabs;
  const pages = [
    ['home','概览','从这里开始'],['apps','应用规则','选择哪些窗口使用标签'],
    ['appearance','标签外观','位置、形状与尺寸'],['colors','标签配色','让不同状态一目了然'],
    ['behavior','操作习惯','按你的习惯工作'],['shortcuts','快捷键','减少鼠标操作'],
    ['workspaces','工作区','记住常用的窗口组合'],['general','设置与帮助','启动、数据与常见问题']
  ];
  let schema, draft, page='home', status={}, busy=false, edge='顶部', apps=null, workspaces=null;
  let search='', restoreTimer=null, generation=0;
  const clone = v => M.clone(v);
  function el(tag, props={}, ...children) {
    const node=document.createElement(tag);
    for (const [k,v] of Object.entries(props)) {
      if (k==='class') node.className=v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2),v);
      else if (k in node) node[k]=v;
      else node.setAttribute(k,v);
    }
    for (const c of children.flat()) if (c!==null&&c!==undefined) node.append(c instanceof Node?c:document.createTextNode(String(c)));
    return node;
  }
  function note(message,error=false) { $('notice').textContent=message; $('notice').className='notice'+(error?' error':''); $('notice').hidden=!message; }
  const errors = {
    CORE_UPDATE_REQUIRED:'当前组件版本较旧，暂时无法在这里设置。请更新插件；更新后可点击“重新连接”。',
    SETTINGS_CONFLICT:'设置已在其他地方发生变化。你的修改仍保留，请先重新读取，再调整并保存。',
    SAVE_FAILED:'设置未能保存。请检查用户文件夹是否允许写入，再重试。',
    SETTINGS_UNTRUSTED:'已有设置无法安全读取。为保护你的数据，暂时停止修改。请先备份设置，再联系开发者。',
    HOTKEY_CONFLICT:'两个操作使用了相同快捷键，请为它们选择不同按键。',
    STARTUP_FAILED:'开机启动设置未能生效。其他设置可能已经保存，请重新读取后检查。',
    WINDOW_CLOSED:'这个窗口已经关闭，请刷新应用列表。', APP_DISABLED:'请先为这个应用启用标签。',
    BUSY:'正在恢复工作区，请等完成后再操作。', UNSUPPORTED_PLATFORM:'窗口标签目前仅支持 Windows。',
    REQUEST_TIMEOUT:'连接等待时间过长。请点击“重新连接”，你的修改仍保留。',
    PIPE_UNAVAILABLE:'暂时无法连接窗口标签，请点击“重新连接”。',CORE_IPC_START_FAILED:'窗口标签未能启动。可能有另一个版本正在运行，请关闭它后重试。'
  };
  async function run(action) {
    if (busy) return;
    busy=true; $('content').inert=true; $('savebar').inert=true;
    $('connectionActions').querySelectorAll('button').forEach(b=>b.disabled=true);
    try { return await action(); }
    catch(e) { note(errors[e.code] || (e.code?'操作没有完成，请重试。仍然失败时，可在帮助中复制诊断信息。':e.message||'操作没有完成'),true); }
    finally { busy=false; $('content').inert=false; $('savebar').inert=false; updateSavebar(); renderConnection(); }
  }
  function button(text,action,cls='') { return el('button',{type:'button',class:cls,onclick:()=>run(action)},text); }
  function card(title,...children) { return el('section',{class:'card'},title?el('h2',{},title):null,...children); }
  function empty(title,text) { return el('div',{class:'card empty'},el('strong',{},title),text); }
  function ask(title,body,accept='确定') {
    $('dialogTitle').textContent=title; $('dialogBody').replaceChildren(body); $('dialogAccept').textContent=accept;
    return new Promise(resolve=>{
      $('dialog').addEventListener('close',()=>resolve($('dialog').returnValue==='ok'),{once:true});
      $('dialog').showModal();
    });
  }
  async function nameDialog(title,value='') {
    const input=el('input',{type:'text',value,maxLength:80,required:true,ariaLabel:'名称'});
    return await ask(title,el('label',{class:'edit-stack'},'名称',input))?input.value.trim():null;
  }
  function updateSavebar() {
    const n=draft?.changes().length||0; $('savebar').hidden=!n;
    $('dirtyCount').textContent=`${n} 项修改尚未保存`;
  }
  function renderConnection() {
    const ready=status.state==='READY', integrated=ready&&status.capabilities?.includes('integrated-settings-v1');
    $('statusDot').className='dot'+(ready&&!status.disabled?' ready':'');
    $('statusText').textContent=ready?(status.disabled?'已暂停':'已启用'):status.state==='UNSUPPORTED_PLATFORM'?'需要 Windows 电脑':status.state==='INSTALLED_STOPPED'?'尚未启用':'等待连接';
    $('statusDescription').textContent=ready?(integrated?(status.disabled?'窗口保留原样，恢复后继续显示标签。':'关闭这个面板后，窗口标签仍会继续工作。'):'当前组件需要更新，暂时无法使用插件内设置。'):status.state==='UNSUPPORTED_PLATFORM'?'可以查看设计说明，窗口管理功能需在 Windows 使用。':'连接成功后，可直接在这里调整所有设置。';
    const actions=$('connectionActions'); actions.replaceChildren();
    if (ready&&integrated) actions.append(button(status.disabled?'恢复使用':'暂停标签',async()=>{
      await api.integrated('setEnabled',{enabled:Boolean(status.disabled)});status=await api.getStatus();render();
    }));
    if (status.state!=='UNSUPPORTED_PLATFORM') actions.append(button(ready?'重新连接':'启用窗口标签',()=>connect(ready)));
    actions.querySelectorAll('button').forEach(b=>b.disabled=busy);
  }
  function navigation() {
    $('navigation').replaceChildren(...pages.map(([id,label])=>el('button',{
      type:'button','aria-current':page===id?'page':'false',onclick:()=>{page=id;search='';$('search').value='';render();loadPage();}
    },label)));
  }
  async function connect(restart=false) {
    const currentGeneration=++generation; note('正在准备窗口标签…');
    status=restart?await api.restart():await api.start();renderConnection();
    if (!status.capabilities?.includes('integrated-settings-v1')) {render();throw Object.assign(new Error(),{code:'CORE_UPDATE_REQUIRED'});}
    const snapshot=await api.integrated('settingsSnapshot');
    if (currentGeneration!==generation) return;
    if (snapshot.contractVersion!==schema.contractVersion) throw Object.assign(new Error(),{code:'CORE_UPDATE_REQUIRED'});
    // Keep an unsaved draft on reconnect. Before-values catch external edits at save time.
    if (!draft||!draft.changes().length) draft=new M.Draft(schema,snapshot);
    else note('已重新连接。你尚未保存的修改仍然保留。');
    apps=null;workspaces=null;render();await loadPage();
    if (!draft.changes().length) note('');
  }
  async function refreshSnapshot(discard=false) {
    if (draft?.changes().length&&!discard&&!await ask('重新读取设置？',el('p',{},'当前未保存的修改将被撤销。'),'重新读取'))return;
    const snapshot=await api.integrated('settingsSnapshot');
    draft=new M.Draft(schema,snapshot);render();note('已读取当前设置。');
  }
  async function save() {
    if (!draft) return;
    for (const input of document.querySelectorAll("#content input")) if (!input.reportValidity()) throw new Error("请检查标出的输入项。");
    draft.validate();
    const snapshot=await api.integrated('settingsApply',{changes:draft.changes()});
    draft.reset(snapshot);render();note('设置已保存并应用。');
  }
  async function loadPage() {
    if (!draft) return;
    const requestedPage=page;
    try {
      if(page==='apps') { apps=await api.integrated('applications'); if(page===requestedPage)render(); }
      if(page==='workspaces') { workspaces=await api.integrated('workspaces'); if(page===requestedPage)render(); }
    } catch(e) { note(errors[e.code]||'无法读取当前内容，请重试。',true); }
  }
  function fieldRow(f) {
    const value=draft.values[f.path], id='field-'+f.path.replaceAll('.','-');
    const controls=el('div',{class:'field-controls'});
    const set=v=>{try{draft.set(f.path,v);updateSavebar();if(f.path==='EnableDarkMode')applyTheme();if(f.page==='shortcuts')render();if(f.type==='color')updatePreview();}catch(e){note(e.message,true);}};
    let input;
    if(f.type==='boolean') input=el('input',{id,type:'checkbox',checked:Boolean(value),onchange:e=>set(e.target.checked)});
    if(f.type==='number') input=el('input',{id,type:'number',min:f.min/(f.scale||1),max:f.max/(f.scale||1),step:1/(f.scale||1),value:value===null?'':value/(f.scale||1),onchange:e=>{
      if(e.target.value===''){e.target.setCustomValidity('请输入数值');return;}e.target.setCustomValidity('');const v=Math.round(Number(e.target.value)*(f.scale||1));try{M.validate(f,v);set(v);}catch(error){e.target.setCustomValidity(error.message);note(error.message,true);}
    }});
    if(f.type==='select') input=el('select',{id,onchange:e=>set(e.target.value)},f.options.map(o=>el('option',{value:o.value,selected:o.value===(value??f.default)},o.label)));
    if(f.type==='color') input=el('input',{id,type:'color',value:'#'+value,oninput:e=>set(e.target.value.slice(1).toUpperCase())});
    if(f.type==='hotkey') {
      const n=/activateTab([1-9])$/.exec(f.path), auto=n&&(draft.values.EnableCtrlNumberHotKey||draft.values.EnableAltNumberHotKey);
      const shown=auto?(draft.values.EnableCtrlNumberHotKey?512:1024)+48+Number(n[1]):value;
      input=el('input',{id,type:'text',readOnly:true,value:M.keyLabel(shown),disabled:Boolean(auto),ariaLabel:f.label,placeholder:'点击后按下组合键',onkeydown:e=>{
        if(e.code==='Tab')return;e.preventDefault();try{const code=M.keyCode(e);if(code!==null)set(code);}catch(error){note(error.message,true);}
      }});
      input.title='点击后按下快捷键；按 Backspace 清除';
    }
    if(f.type==='edges') input=el('div',{class:'actions'},[['Top','顶部'],['Left','左侧'],['Right','右侧'],['Bottom','底部']].map(([v,label])=>el('label',{},el('input',{type:'checkbox',checked:value.includes(v),onchange:e=>{
      const next=e.target.checked?[...draft.values[f.path],v]:draft.values[f.path].filter(x=>x!==v);if(!next.length){e.target.checked=true;note('至少保留一个标签位置。',true);return;}set(next);
    }}),label)));
    if(f.inherit) {
      input.disabled=value===null;
      controls.append(el('label',{class:'inherit'},el('input',{type:'checkbox',checked:value===null,onchange:e=>{set(e.target.checked?null:f.default);render();}}),'自动'));
    }
    controls.append(input);if(f.unit)controls.append(el('span',{class:'unit'},f.unit));
    return el('div',{class:'row'},el('div',{class:'row-label'},el('label',{htmlFor:id},f.label),f.description?el('p',{class:'help'},f.description):null),controls);
  }
  function settingsPage() {
    const content=[];
    if(page==='appearance') {
      content.push(el('p',{class:'help'},'顶部设置也作为默认样式。其他边缘选择“自动”时使用原版的继承规则。'),
        el('div',{class:'pill-list'},['顶部','左侧','右侧','底部'].map(name=>el('button',{type:'button',class:edge===name?'selected':'',onclick:()=>{edge=name;render();}},name))));
    }
    const fs=schema.fields.filter(f=>f.page===page && (!search||f.label.includes(search)) &&
      (page!=='appearance'||f.path==='TabEdges'||(f.group||'顶部')===edge));
    const groups=new Map();for(const f of fs){const name=f.group||({general:'日常使用',behavior:'窗口与标签',appearance:'布局',shortcuts:'快捷键'}[page])||'设置';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(fieldRow(f));}
    for(const [name,rows] of groups)content.push(card(name,...rows));
    if(!fs.length)content.push(empty('没有找到设置','尝试使用其他关键词。'));
    if(page==='shortcuts')content.unshift(el('p',{class:'help'},'点击输入框后按下组合键；按 Backspace 清除。数字模式启用时，第 1–9 个标签使用统一组合键。'));
    return content;
  }
  function updatePreview() {
    const target=$('colorPreview');if(!target)return;
    const states=[['Inactive','未选中'],['Selected','已选择'],['MouseOver','鼠标停留'],['Active','当前窗口'],['Flash','提醒']];
    target.replaceChildren(...states.map(([state,label])=>{
      const tab=el('span',{},label);tab.style.color='#'+draft.values[`TabAppearance.tab${state}TextColor`];tab.style.backgroundColor='#'+draft.values[`TabAppearance.tab${state}TabColor`];tab.style.borderColor='#'+draft.values[`TabAppearance.tab${state}BorderColor`];return tab;
    }));
  }
  function colorsPage() {
    const presets=el('select',{ariaLabel:'配色方案'},el('option',{value:''},'选择配色方案…'));
    draft.snapshot.presets.forEach((p,i)=>presets.append(el('option',{value:'p'+i},p.name)));
    draft.snapshot.customThemes.forEach((p,i)=>presets.append(el('option',{value:'c'+i},p.name+' · 我的配色')));
    presets.addEventListener('change',()=>{if(!presets.value)return;const i=Number(presets.value.slice(1));draft.applyPreset(presets.value[0]==='p'?draft.snapshot.presets[i].colors:M.colorsFromTheme(draft.snapshot.customThemes[i]));render();});
    const themeActions=el('div',{class:'actions'},presets,button('保存为我的配色',async()=>{
      const name=await nameDialog('保存当前配色');if(!name)return;
      const themes=clone(draft.snapshot.customThemes);themes.push(M.themeFromValues(name,draft.values));
      const snapshot=await api.integrated('themesUpdate',{items:themes,revision:draft.snapshot.revision});
      draft.snapshot.customThemes=snapshot.customThemes;draft.snapshot.revision=snapshot.revision;render();note('配色方案已保存。当前外观修改仍需点击“保存修改”。');
    }));
    const saved=el('div',{});
    draft.snapshot.customThemes.forEach((t,i)=>saved.append(el('div',{class:'row'},el('span',{},t.name),el('div',{class:'actions'},
      button('改名',async()=>{const name=await nameDialog('修改配色名称',t.name);if(name){const items=clone(draft.snapshot.customThemes);items[i].name=name;await saveThemes(items);}}),
      button('上移',async()=>{if(i){const items=clone(draft.snapshot.customThemes);[items[i-1],items[i]]=[items[i],items[i-1]];await saveThemes(items);}}),
      button('删除',async()=>{if(await ask('删除这个配色？',el('p',{},t.name),'删除'))await saveThemes(draft.snapshot.customThemes.filter((_,n)=>n!==i));},'danger')))));
    return [card('配色方案',themeActions,el('div',{id:'colorPreview',class:'preview'}),el('p',{class:'help'},'这是颜色示意；实际标签的形状与尺寸由“标签外观”决定。')),...settingsPage(),...(draft.snapshot.customThemes.length?[card('我的配色',saved)]:[])];
  }
  async function saveThemes(items) {
    const snapshot=await api.integrated('themesUpdate',{items,revision:draft.snapshot.revision});
    draft.snapshot.customThemes=snapshot.customThemes;draft.snapshot.revision=snapshot.revision;render();
  }
  function appsPage() {
    if(!apps)return [empty('正在读取应用','稍候即可管理正在运行和已保存的应用。')];
    const content=[el('div',{class:'actions'},button('刷新列表',loadPage),el('span',{class:'help'},'为应用启用标签后，可让同一应用的窗口自动合并。'))];
    for(const app of apps.apps.filter(a=>!search||(a.name+' '+a.path).toLowerCase().includes(search.toLowerCase()))) {
      const enabled=el('input',{type:'checkbox',checked:app.enabled,ariaLabel:'为'+app.name+'启用标签'}), group=el('input',{type:'checkbox',checked:app.autoGroup,disabled:!app.enabled,ariaLabel:'自动合并'+app.name});
      const category=el('select',{ariaLabel:app.name+'分组类别'},el('option',{value:0,selected:app.category===0},'不指定类别'),...Array.from({length:10},(_,i)=>el('option',{value:i+1,selected:app.category===i+1},'类别 '+(i+1))));
      const update=()=>run(async()=>{apps=await api.integrated('applicationUpdate',{path:app.path,enabled:enabled.checked,autoGroup:enabled.checked&&group.checked,category:Number(category.value)});render();});
      enabled.onchange=update;group.onchange=update;category.onchange=update;
      content.push(card('',el('div',{class:'app-head'},el('strong',{},app.name),el('span',{class:'tag'},app.running?'正在运行':'已保存规则')),
        el('div',{class:'row'},el('label',{},enabled,' 使用标签'),el('label',{},group,' 自动合并')),category,
        el('p',{class:'help'},'同一类别的应用可以合并到一起。'),
        el('details',{},el('summary',{},`窗口与规则详情（${app.windows.length}）`),el('p',{class:'path'},app.path),
          app.windows.map(w=>el('label',{class:'window-row'},el('span',{},w.title||'无标题窗口'),el('input',{type:'checkbox',checked:w.enabled,disabled:!app.enabled,ariaLabel:'为'+w.title+'使用标签',onchange:e=>run(async()=>{apps=await api.integrated('windowUpdate',{id:w.id,enabled:e.target.checked});render();})}))),
          button('移除保存的规则',async()=>{if(await ask('移除这个应用的规则？',el('p',{},'该应用将重新遵循默认规则。'),'移除')){apps=await api.integrated('applicationUpdate',{path:app.path,remove:true});render();}}))));
    }
    if(content.length===1)content.push(empty('暂时没有应用','请先打开需要使用标签的窗口，再刷新列表。'));
    return content;
  }
  async function saveWorkspaces(items) {workspaces=await api.integrated('workspaceUpdate',{items,revision:workspaces.revision});render();}
  async function editWindow(w,wi,gi,xi) {
    const name=el('input',{type:'text',value:w.name,maxLength:150}),title=el('input',{type:'text',value:w.title,maxLength:1024});
    const match=el('select',{},...['完全相同','以这些文字开头','以这些文字结尾','包含这些文字','高级：正则表达式'].map((label,i)=>el('option',{value:i,selected:w.matchType===i},label)));
    const tabName=el('input',{type:'text',value:w.tabName||'',maxLength:150});
    if(await ask('编辑工作区中的窗口',el('div',{class:'edit-stack'},el('label',{},'显示名称',name),el('label',{},'匹配窗口标题',title),el('label',{},'匹配方式',match),el('p',{class:'help'},'仅匹配已经打开的窗口。高级匹配适合熟悉正则表达式的用户。'),el('label',{},'自定义标签名称（可留空）',tabName)))) {
      const items=clone(workspaces.items),item=items[wi].groups[gi].windows[xi];Object.assign(item,{name:name.value,title:title.value,matchType:Number(match.value)});
      if(tabName.value){item.tabName=tabName.value;if(item.tabOrder===undefined)item.tabOrder=item.zorder;}else delete item.tabName;
      await saveWorkspaces(items);
    }
  }
  function workspacesPage() {
    if(!workspaces)return [empty('正在读取工作区','稍候即可保存或恢复窗口组合。')];
    const content=[el('div',{class:'actions'},button('保存当前窗口组合',async()=>{
      const all=el('input',{type:'checkbox'});
      if(!await ask('保存当前窗口组合',el('div',{},el('p',{},'记录已有标签组中的窗口、顺序和布局。之后可恢复已经打开的窗口。'),el('label',{},all,' 包含其他虚拟桌面上的标签组')),'保存'))return;
      workspaces=await api.integrated('workspaceCapture',{allDesktops:all.checked,revision:workspaces.revision});render();
    },'primary'),button('刷新',loadPage)),el('p',{class:'help'},'工作区会整理已打开的窗口，不会自动启动应用或打开文件。')];
    workspaces.items.forEach((ws,wi)=>{
      if(search&&!ws.name.includes(search))return;
      const tree=el('details',{},el('summary',{},`${ws.groups.length} 个标签组 · 查看和编辑窗口`));
      ws.groups.forEach((g,gi)=>tree.append(el('div',{class:'workspace-tree'},el('div',{class:'card-title'},el('h3',{},g.name),button('移除此组',async()=>{if(await ask('从工作区移除这个标签组？',el('p',{},'当前打开的窗口不会关闭。'),'移除')){const items=clone(workspaces.items);items[wi].groups.splice(gi,1);await saveWorkspaces(items);}})),...g.windows.map((w,xi)=>el('div',{class:'row'},el('span',{},w.name||w.title),el('div',{class:'actions'},button('编辑',()=>editWindow(w,wi,gi,xi)),button('移除',async()=>{if(await ask('从工作区移除这个窗口？',el('p',{},w.name||w.title),'移除')){const items=clone(workspaces.items);items[wi].groups[gi].windows.splice(xi,1);await saveWorkspaces(items);}})))))));
      content.push(card('',el('div',{class:'card-title'},el('h2',{},ws.name),el('div',{class:'actions'},button('恢复',()=>restore(wi),'primary'),button('改名',async()=>{const name=await nameDialog('工作区名称',ws.name);if(name){const items=clone(workspaces.items);items[wi].name=name;await saveWorkspaces(items);}}),button('删除',async()=>{if(await ask('删除这个工作区？',el('p',{},'只删除保存的组合，当前窗口不会关闭。'),'删除'))await saveWorkspaces(workspaces.items.filter((_,i)=>i!==wi));},'danger'))),tree));
    });
    if(!workspaces.items.length)content.push(empty('保存你的第一个工作区','先把窗口整理成标签组，再点击“保存当前窗口组合”。'));
    return content;
  }
  async function restore(index) {
    if(!await ask('恢复这个工作区？',el('p',{},'已经打开且匹配的窗口将重新分组和排列，未打开的窗口会跳过。'),'恢复'))return;
    let job=await api.integrated('workspaceRestore',{index,revision:workspaces.revision});
    const report=()=>{
      if(job.running){note('正在恢复窗口布局，请稍候…');return;}
      const missing=Math.max(0,job.total-job.matched);
      note(`恢复已结束：匹配到 ${job.matched} 个窗口${missing?'，'+missing+' 个窗口未打开或未匹配':''}${job.errors?'；有部分布局未能恢复':''}。`,Boolean(job.errors));
    };report();
    clearTimeout(restoreTimer);
    const poll=async()=>{try{job=await api.integrated('workspaceRestoreStatus',{jobId:job.jobId});report();if(job.running)restoreTimer=setTimeout(poll,600);}catch(e){note('无法确认恢复结果，请检查窗口后重新连接。',true);}};
    if(job.running)restoreTimer=setTimeout(poll,600);
  }
  async function exportBackup() {
    if(draft.changes().length&&!await ask('导出已保存的设置？',el('p',{},'未保存的修改不会包含在备份里。'),'继续'))return;
    const snapshot=await api.integrated('settingsSnapshot'),ws=await api.integrated('workspaces');
    if(await api.exportBackup({format:'windowtabs-utools-settings',version:1,values:snapshot.values,themes:snapshot.customThemes,workspaces:ws.items}))note('设置备份已导出。请妥善保管，备份可能包含应用路径和窗口标题。');
  }
  function generalPage() {
    return [...settingsPage(),card('备份与恢复',el('p',{class:'help'},'备份包含外观、操作习惯、快捷键、配色和工作区。应用规则由原设置文件保留，完整备份请同时保留该文件。'),el('div',{class:'actions'},button('导出设置备份',exportBackup),button('导入设置备份',()=>{$('importFile').value='';$('importFile').click();}))),
      card('数据存放位置',el('p',{class:'help'},'默认保存在 Windows 用户文件夹，更新插件时保留。只有需要随文件移动设置时才使用便携模式。'),el('div',{class:'actions'},button('查看存放位置',async()=>{
        const info=await api.integrated('storageInfo');await ask('数据存放位置',el('div',{},el('p',{},info.location==='user'?'当前使用用户文件夹':'当前使用便携文件夹'),el('p',{class:'path'},info.path),el('p',{},info.writable?'可以保存修改':'当前无法写入')),'知道了');
      }),button('切换存放方式',async()=>{
        if(draft.changes().length)throw new Error('请先保存或撤销当前修改。');
        const info=await api.integrated('storageInfo'),snapshot=await api.integrated('settingsSnapshot');
        const toPortable=info.location!=='portable';
        if(await ask('切换数据存放方式？',el('p',{},toPortable?'将设置移动到内置组件旁边，并保留原文件备份。更新组件前需先返回用户文件夹，以免设置随旧目录遗留。':'将便携设置移回 Windows 用户文件夹。若目标已有设置，将停止操作以避免覆盖。'),'切换')){await api.integrated('storageTransfer',{toPortable,move:true,revision:snapshot.revision});await refreshSnapshot(true);note('已切换数据存放位置。');}
      }))),card('帮助',el('p',{class:'help'},'关闭面板或退出 uTools 后，窗口标签继续运行。卸载插件前，请先关闭“开机启动”，然后停止窗口标签。'),el('details',{},el('summary',{},'连接失败或无法使用？'),el('p',{class:'help'},'先尝试重新连接。如果另一个独立版本正在运行，请先退出它。仍然失败时，把诊断信息交给开发者；信息可能包含你的用户名与本地路径。'),el('div',{class:'actions'},button('重新读取设置',()=>refreshSnapshot()),button('复制诊断信息',async()=>{await api.copyDiagnostics();note('诊断信息已复制。分享前请检查其中的个人路径。');}),button('停止窗口标签',async()=>{if(await ask('停止窗口标签？',el('p',{},'所有应用窗口会保留，但不再显示标签。'),'停止')){status=await api.stop();draft=null;render();}}))),el('p',{class:'help'},'插件版本 0.3.0 · 基于开源 WindowTabs'))];
  }
  async function importBackup(file) {
    if(!file)return;if(file.size>750000)throw new Error('备份文件过大，请选择小于 750 KB 的文件。');
    let data;try{data=JSON.parse(await file.text());}catch(_){throw new Error('无法读取这个备份文件，请选择有效的设置备份。');}
    if(data.format!=='windowtabs-utools-settings'||data.version!==1||!data.values||!Array.isArray(data.themes)||!Array.isArray(data.workspaces))throw new Error('这个文件不是受支持的窗口标签备份。');
    if(draft.changes().length)throw new Error('请先保存或撤销当前修改，再导入备份。');
    const current=await api.integrated('settingsSnapshot'),next=new M.Draft(schema,current);
    for(const f of schema.fields)if(Object.hasOwn(data.values,f.path))next.set(f.path,data.values[f.path]);next.validate();
    if(!await ask('导入这份设置备份？',el('p',{},`将更改 ${next.changes().length} 项设置，并替换我的配色（${data.themes.length} 个）和工作区（${data.workspaces.length} 个）。建议先导出当前备份。`),'导入'))return;
    // Native backup is taken before the first persisted write. Each operation returns readback.
    let applied=0;
    try {
      const saved=await api.integrated('settingsApply',{changes:next.changes()});applied++;
      const themes=await api.integrated('themesUpdate',{items:data.themes,revision:saved.revision});applied++;
      await api.integrated('workspaceUpdate',{items:data.workspaces,revision:themes.revision});applied++;
      await refreshSnapshot(true);note('备份已导入。');
    }catch(e){await refreshSnapshot(true);note(`导入在第 ${applied+1} 步停止，部分内容可能已保存。请检查当前设置，必要时用原备份恢复。`,true);}
  }
  function homePage() {
    return [el('div',{class:'intro'},el('h2',{},'把多个窗口，整理成一组标签'),el('p',{class:'help'},'直接在 uTools 里选择应用、调整外观、保存常用组合。')),
      card('开始使用',el('ol',{class:'steps'},el('li',{},'打开你常用的应用窗口。'),el('li',{},'在“应用规则”中，为需要的应用开启“使用标签”。'),el('li',{},'将标签拖到一起组合；常用组合可以保存为工作区。')),
        button('选择需要标签的应用',async()=>{page='apps';render();await loadPage();},'primary')),
      card('按你的习惯调整',el('div',{class:'actions'},button('调整标签外观',()=>{page='appearance';render();}),button('选择配色',()=>{page='colors';render();}),button('设置快捷键',()=>{page='shortcuts';render();})))];
  }
  function applyTheme(){document.body.classList.toggle('dark',Boolean(draft?.values.EnableDarkMode));}
  function render() {
    navigation();const meta=pages.find(p=>p[0]===page);$('pageTitle').textContent=meta[1];$('pageHint').textContent=meta[2];
    $('search').hidden=page==='home';applyTheme();renderConnection();
    if(!draft) {
      $('content').replaceChildren(empty(status.state==='UNSUPPORTED_PLATFORM'?'窗口标签仅支持 Windows':'连接后开始设置','连接成功前，不会读取默认值覆盖你的原设置。'),card('遇到问题？',button('复制诊断信息',async()=>{await api.copyDiagnostics();note('诊断信息已复制。');})));
    }else {
      const nodes=page==='home'?homePage():page==='apps'?appsPage():page==='workspaces'?workspacesPage():page==='colors'?colorsPage():page==='general'?generalPage():settingsPage();
      $('content').replaceChildren(...nodes);updatePreview();
    }
    updateSavebar();
  }
  $('save').onclick=()=>run(save);
  $('discard').onclick=()=>run(async()=>{if(await ask('撤销未保存的修改？',el('p',{},'已保存的设置不受影响。'),'撤销')){draft.reset(draft.snapshot);render();note('已撤销未保存的修改。');}});
  $('search').oninput=e=>{search=e.target.value.trim();render();};
  $('importFile').onchange=e=>run(()=>importBackup(e.target.files[0]));
  if(!api){status={state:'UNSUPPORTED_PLATFORM'};render();note('请在 uTools 中打开插件。');return;}
  schema=api.getSchema();
  api.onEvent(({event,payload})=>{
    if(event==='navigate'){page=payload.page;render();if(draft)loadPage();}
    if(event==='stateChanged'){status=payload;renderConnection();}
    if(event==='error')note(errors[payload?.code]||'窗口标签暂时不可用，请重新连接。',true);
  });
  run(async()=>{status=await api.getStatus();render();if(status.state!=='UNSUPPORTED_PLATFORM')await connect();});
})();
