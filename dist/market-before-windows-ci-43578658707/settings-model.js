/* Shared by the renderer and tests. Values use the native representation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SettingsModel = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function validate(field, value) {
    if (value === null && field.inherit) return;
    const fail = () => { throw new Error(`${field.label}的值不正确`); };
    switch (field.type) {
      case 'boolean': if (typeof value !== 'boolean') fail(); break;
      case 'number': case 'hotkey':
        if (!Number.isInteger(value) || value < field.min || value > field.max) fail(); break;
      case 'select': if (!field.options.some(o => o.value === value)) fail(); break;
      case 'color': if (typeof value !== 'string' || !/^[0-9a-f]{6}$/i.test(value)) fail(); break;
      case 'edges': if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length || value.some(v=>!['Top','Left','Right','Bottom'].includes(v))) fail(); break;
      default: fail();
    }
  }
  class Draft {
    constructor(schema, snapshot) { this.schema = schema; this.reset(snapshot); }
    reset(snapshot) {
      if (!snapshot || snapshot.contractVersion !== this.schema.contractVersion || !snapshot.values ||
        this.schema.fields.some(f => !(f.path in snapshot.values))) throw new Error('设置内容不完整，请更新插件后重试');
      this.snapshot = clone(snapshot); this.base = clone(snapshot.values);
      this.values = clone(snapshot.values);
    }
    set(key, value) {
      const field = this.schema.fields.find(f=>f.path===key);
      if (!field) throw new Error('未知设置项');
      validate(field,value); this.values[key] = value;
      // Numeric key modes are exclusive. Keep custom bindings stored.
      if (key === 'EnableCtrlNumberHotKey' && value) this.values.EnableAltNumberHotKey = false;
      if (key === 'EnableAltNumberHotKey' && value) this.values.EnableCtrlNumberHotKey = false;
    }
    changes() {
      return this.schema.fields.filter(f=>!equal(this.base[f.path],this.values[f.path]))
        .map(f=>({path:f.path, before:clone(this.base[f.path]), value:clone(this.values[f.path])}));
    }
    validate() {
      this.changes().forEach(c=>validate(this.schema.fields.find(f=>f.path===c.path),c.value));
      const keys = new Map();
      for (const f of this.schema.fields.filter(f=>f.type==='hotkey')) {
        const n = /^HotKeys.activateTab([1-9])$/.exec(f.path);
        const code = n && this.values.EnableCtrlNumberHotKey ? 512+48+Number(n[1]) :
          n && this.values.EnableAltNumberHotKey ? 1024+48+Number(n[1]) : this.values[f.path];
        if (!code) continue;
        if (keys.has(code)) throw new Error(`${f.label}与${keys.get(code)}使用了相同快捷键`);
        keys.set(code,f.label);
      }
    }
    applyPreset(preset) {
      for (const f of this.schema.fields.filter(f=>f.type==='color')) {
        const key = f.path.split('.')[1];
        if (preset[key] !== undefined) this.set(f.path,preset[key]);
      }
    }
  }
  function keyCode(event) {
    const key = event.code;
    if (event.metaKey) throw new Error('暂不支持 Windows 键，请使用 Ctrl、Alt 或 Shift');
    if (['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight'].includes(key)) return null;
    if (key==='Escape') return null;
    if ((key==='Backspace'||key==='Delete')&&!event.ctrlKey&&!event.altKey&&!event.shiftKey) return 0;
    const special={Space:32,Tab:9,Enter:13,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,PageUp:33,PageDown:34,Insert:45,Delete:46,Backspace:8,Comma:188,Period:190,Slash:191,Semicolon:186,Quote:222,BracketLeft:219,BracketRight:221,Backslash:220,Minus:189,Equal:187,Backquote:192};
    const vk = /^Key[A-Z]$/.test(key)?key.charCodeAt(3):/^Digit[0-9]$/.test(key)?key.charCodeAt(5):/^F([1-9]|1[0-9]|2[0-4])$/.test(key)?111+Number(key.slice(1)):special[key];
    if (!vk) throw new Error('暂不支持这个按键');
    return vk | ((Number(event.shiftKey) | Number(event.ctrlKey)<<1 | Number(event.altKey)<<2)<<8);
  }
  function keyLabel(code) {
    if (!code) return '未设置';
    const vk=code&255, flags=code>>>8;
    const names={8:'Backspace',9:'Tab',13:'Enter',32:'空格',33:'Page Up',34:'Page Down',35:'End',36:'Home',37:'←',38:'↑',39:'→',40:'↓',45:'Insert',46:'Delete',188:',',190:'.',191:'/',186:';',222:"'",219:'[',221:']',220:'\\',189:'-',187:'=',192:'`'};
    return [...(flags&2?['Ctrl']:[]),...(flags&4?['Alt']:[]),...(flags&1?['Shift']:[]),vk>=112&&vk<=135?'F'+(vk-111):names[vk]||String.fromCharCode(vk)].join(' + ');
  }
  function themeFromValues(name,values) {
    const out={name};
    for (const key of Object.keys(values).filter(k=>/^TabAppearance\.tab.*Color$/.test(k))) {
      const field=key.split('.')[1].slice(3); const native=field[0].toLowerCase()+field.slice(1);
      out[native]=(parseInt(values[key],16)|0xff000000);
    }
    return out;
  }
  function colorsFromTheme(theme) {
    const out={};
    for (const [key,v] of Object.entries(theme)) if (/Color$/.test(key)&&Number.isInteger(v))
      out['tab'+key[0].toUpperCase()+key.slice(1)]=(v>>>0).toString(16).padStart(8,'0').slice(-6).toUpperCase();
    return out;
  }
  return {clone,equal,validate,Draft,keyCode,keyLabel,themeFromValues,colorsFromTheme};
});
