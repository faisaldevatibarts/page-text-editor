// Injected on demand. Each injection toggles the editor; the last expression returns the new state.
(() => {
  const KEY = '__pageEditorPro';
  if (window[KEY]) return window[KEY].toggle();

  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font:500 12px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.box{position:fixed;pointer-events:none;display:none;border-radius:2px}
.hover{border:1.5px dashed #7c9cff;background:rgba(124,156,255,.08)}
.sel{border:2px solid #3b5bdb;background:rgba(59,91,219,.10)}
.tag{position:absolute;left:-2px;top:-24px;background:#3b5bdb;color:#fff;padding:2px 7px;border-radius:5px;white-space:nowrap;font-size:11px}
.bar{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;width:max-content;max-width:94vw;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;justify-content:center;padding:10px;background:#181a1f;color:#ecedf0;border:1px solid #2a2d35;border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.5);pointer-events:auto}
.bar.top{bottom:auto;top:14px}
.hint{flex-basis:100%;text-align:center;color:#8b90a0;font-size:11px}
.grp{display:flex;align-items:center;gap:3px;padding-right:10px;border-right:1px solid #2a2d35}
.grp:last-child{border-right:0;padding-right:0}
button{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 9px;border-radius:7px;background:rgba(255,255,255,.08);color:#ecedf0;font-weight:600;font-size:12px;transition:background .15s}
button:hover:not(:disabled){background:rgba(255,255,255,.18)}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #7c9cff;outline-offset:1px}
button:disabled{opacity:.35;cursor:default}
button.danger:hover:not(:disabled){background:#a3303a}
button.primary{background:#3b5bdb}
label.col{display:flex;align-items:center;gap:4px;color:#9aa0b4;font-size:11px}
input[type=color]{width:26px;height:22px;padding:0;border:1px solid #2a2d35;border-radius:5px;background:none;cursor:pointer}
input[type=color]:disabled{opacity:.35}
.toast{position:fixed;left:50%;top:60px;transform:translateX(-50%);background:#181a1f;color:#ecedf0;border:1px solid #7c9cff;border-radius:10px;padding:8px 14px;display:none;pointer-events:none}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;pointer-events:auto}
.panel{width:min(720px,92vw);background:#181a1f;border:1px solid #2a2d35;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;color:#ecedf0}
textarea{width:100%;height:46vh;resize:vertical;background:#101114;color:#ecedf0;border:1px solid #2a2d35;border-radius:8px;padding:8px;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace}
.row{display:flex;gap:8px;justify-content:flex-end}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

  const BLOCK = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'auxclick'];

  let on = false;
  let host = null, root = null, ui = {};
  let hoverEl = null, selEl = null, stack = [];
  let editing = false, editEl = null, editBeforeNodes = null, editBeforeHtml = '', editAttr = null;
  let hist = [], redoStack = [];
  let raf = 0, lastPick = { x: -1, y: -1, i: 0 }, pending = null, toastTimer = 0;

  const notify = () => { try { chrome.runtime.sendMessage({ type: 'PE_STATE', on }); } catch { /* ignore */ } };
  const isRoot = (el) => !el || el === document.body || el === document.documentElement;
  const ours = (e) => host && e.composedPath().includes(host);

  // ---------- UI ----------
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function mkBtn(label, title, fn, cls = '') {
    const b = mk('button', cls, label);
    b.type = 'button'; b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep caret/focus where it was
    b.addEventListener('click', () => { try { fn(); } catch (err) { toast(err.message); } });
    return b;
  }
  function mkColor(label, prop) {
    const l = mk('label', 'col', label);
    const i = document.createElement('input');
    i.type = 'color';
    i.addEventListener('input', () => {
      if (!selEl) return;
      if (!pending) pending = { el: selEl, prop, old: selEl.style[prop] };
      selEl.style[prop] = i.value;
    });
    i.addEventListener('change', () => {
      if (pending) {
        const { el, prop: p, old } = pending; const nv = el.style[p];
        push({ undo: () => { el.style[p] = old; }, redo: () => { el.style[p] = nv; } });
        pending = null;
      }
    });
    l.append(i);
    return { wrap: l, input: i };
  }
  const grp = (...kids) => { const g = mk('div', 'grp'); g.append(...kids); return g; };

  function buildUi() {
    host = document.createElement('div');
    host.setAttribute('contenteditable', 'false');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
    root = host.attachShadow({ mode: 'open' });
    try { const s = new CSSStyleSheet(); s.replaceSync(CSS); root.adoptedStyleSheets = [s]; }
    catch { const s = document.createElement('style'); s.textContent = CSS; root.append(s); }

    ui.hover = mk('div', 'box hover');
    ui.sel = mk('div', 'box sel');
    ui.tag = mk('div', 'tag');
    ui.sel.append(ui.tag);

    ui.b = {};
    ui.b.parent = mkBtn('Parent', 'Select the parent section', parentSel);
    ui.b.child = mkBtn('Child', 'Go back down', childSel);
    ui.b.text = mkBtn('Edit text', 'Edit text (or double-click)', () => startEdit());
    ui.b.html = mkBtn('HTML', 'Edit the element HTML', openHtml);
    ui.b.image = mkBtn('Image', 'Replace image from a file', () => { ui.file.value = ''; ui.file.click(); });
    ui.b.imageUrl = mkBtn('Image URL', 'Replace image from a URL', imageFromUrl);
    ui.color = mkColor('Text', 'color');
    ui.bg = mkColor('Bg', 'backgroundColor');
    ui.b.fontDown = mkBtn('A-', 'Smaller text', () => fontStep(-2));
    ui.b.fontUp = mkBtn('A+', 'Larger text', () => fontStep(2));
    ui.b.dup = mkBtn('Duplicate', 'Duplicate (Ctrl+D)', duplicate, 'primary');
    ui.b.up = mkBtn('Up', 'Move before previous sibling', () => move(-1));
    ui.b.down = mkBtn('Down', 'Move after next sibling', () => move(1));
    ui.b.del = mkBtn('Delete', 'Delete (Del)', del, 'danger');
    ui.b.undo = mkBtn('Undo', 'Undo (Ctrl+Z)', undo);
    ui.b.redo = mkBtn('Redo', 'Redo (Ctrl+Shift+Z)', redo);
    ui.b.pos = mkBtn('Move bar', 'Move this bar to the top or bottom', () => ui.bar.classList.toggle('top'));
    ui.b.done = mkBtn('Done', 'Exit editor (Esc)', () => stop());

    ui.bar = mk('div', 'bar');
    ui.bar.append(
      mk('div', 'hint', ''),
      grp(ui.b.parent, ui.b.child),
      grp(ui.b.text, ui.b.html, ui.b.image, ui.b.imageUrl),
      grp(ui.color.wrap, ui.bg.wrap, ui.b.fontDown, ui.b.fontUp),
      grp(ui.b.dup, ui.b.up, ui.b.down, ui.b.del),
      grp(ui.b.undo, ui.b.redo, ui.b.pos, ui.b.done)
    );

    ui.file = document.createElement('input');
    ui.file.type = 'file'; ui.file.accept = 'image/*'; ui.file.style.display = 'none';
    ui.file.addEventListener('change', () => {
      const f = ui.file.files && ui.file.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => applyImage(String(r.result));
      r.readAsDataURL(f);
    });

    ui.toast = mk('div', 'toast');
    ui.ta = document.createElement('textarea');
    ui.ta.spellcheck = false;
    const apply = mkBtn('Apply', 'Replace the element with this HTML', applyHtml, 'primary');
    const cancel = mkBtn('Cancel', 'Close', () => { ui.modal.style.display = 'none'; });
    const panel = mk('div', 'panel');
    panel.append(mk('div', '', 'Edit HTML of the selected element. Scripts are not executed.'), ui.ta, (() => { const r = mk('div', 'row'); r.append(cancel, apply); return r; })());
    ui.modal = mk('div', 'modal');
    ui.modal.append(panel);

    root.append(ui.hover, ui.sel, ui.bar, ui.toast, ui.modal, ui.file);
    document.documentElement.append(host);
  }

  function toast(text) {
    ui.toast.textContent = text; ui.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (ui.toast) ui.toast.style.display = 'none'; }, 3200);
  }

  // ---------- overlay ----------
  function box(b, el) {
    if (!el || !el.isConnected) { b.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    b.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  }
  function place() {
    raf = 0;
    if (!on) return;
    box(ui.hover, hoverEl && hoverEl !== selEl ? hoverEl : null);
    box(ui.sel, selEl);
    if (selEl) {
      const r = selEl.getBoundingClientRect();
      const cls = typeof selEl.className === 'string' ? selEl.className.trim().split(/\s+/)[0] : '';
      ui.tag.textContent = selEl.tagName.toLowerCase() + (selEl.id ? '#' + selEl.id : '') + (cls ? '.' + cls : '') + '  ' + Math.round(r.width) + 'x' + Math.round(r.height);
      ui.tag.style.top = r.top < 28 ? '2px' : '-24px';
    }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  function toHex(css) {
    const m = (css || '').match(/[\d.]+/g);
    if (!m || m.length < 3 || (m.length > 3 && parseFloat(m[3]) === 0)) return '#ffffff';
    return '#' + m.slice(0, 3).map((n) => Math.round(parseFloat(n)).toString(16).padStart(2, '0')).join('');
  }
  function imgTarget(el) {
    if (!el) return null;
    if (el.tagName === 'IMG') return el;
    const bgi = getComputedStyle(el).backgroundImage;
    if (bgi && bgi !== 'none') return el;
    return el.querySelector('img');
  }
  function refreshUi() {
    const has = !!selEl, rootSel = isRoot(selEl);
    const dis = (b, v) => { b.disabled = !!v; };
    dis(ui.b.parent, !has || !selEl.parentElement || selEl.parentElement === document.documentElement);
    dis(ui.b.child, !has || !(stack.length || selEl.firstElementChild));
    dis(ui.b.text, !has || editing);
    dis(ui.b.html, !has || rootSel);
    dis(ui.b.image, !imgTarget(selEl));
    dis(ui.b.imageUrl, !imgTarget(selEl));
    dis(ui.b.fontDown, !has); dis(ui.b.fontUp, !has);
    dis(ui.color.input, !has); dis(ui.bg.input, !has);
    dis(ui.b.dup, !has || rootSel); dis(ui.b.del, !has || rootSel);
    dis(ui.b.up, !has || rootSel || !selEl.previousElementSibling);
    dis(ui.b.down, !has || rootSel || !selEl.nextElementSibling);
    dis(ui.b.undo, !hist.length && !editing); dis(ui.b.redo, !redoStack.length);
    if (has) {
      const cs = getComputedStyle(selEl);
      ui.color.input.value = toHex(cs.color);
      ui.bg.input.value = toHex(cs.backgroundColor);
    }
    schedule();
  }

  // ---------- history ----------
  function push(op) { hist.push(op); redoStack = []; refreshUi(); }
  function undo() {
    if (editing && document.execCommand('undo')) { schedule(); return; }
    const op = hist.pop();
    if (!op) return;
    op.undo(); redoStack.push(op); afterChange();
  }
  function redo() {
    if (editing && document.execCommand('redo')) { schedule(); return; }
    const op = redoStack.pop();
    if (!op) return;
    op.redo(); hist.push(op); afterChange();
  }
  function afterChange() { if (selEl && !selEl.isConnected) selEl = null; refreshUi(); }

  // ---------- selection ----------
  function pick(x, y, cycle) {
    const list = document.elementsFromPoint(x, y).filter((el) => el !== host && el !== document.documentElement);
    if (!list.length) return null;
    let i = 0;
    if (cycle && lastPick.x === x && lastPick.y === y) i = (lastPick.i + 1) % list.length;
    lastPick = { x, y, i };
    return list[i];
  }
  function select(el, keepStack) {
    if (el === selEl) return;
    endEdit();
    if (!keepStack) stack = [];
    selEl = el;
    refreshUi();
  }
  function parentSel() {
    const p = selEl && selEl.parentElement;
    if (p && p !== document.documentElement) { stack.push(selEl); select(p, true); }
  }
  function childSel() {
    const c = stack.pop();
    if (c && selEl.contains(c)) select(c, true);
    else if (selEl.firstElementChild) select(selEl.firstElementChild, true);
  }

  // ---------- text editing ----------
  function startEdit() {
    if (!selEl || editing) return;
    editing = true; editEl = selEl;
    editBeforeNodes = Array.from(editEl.childNodes, (n) => n.cloneNode(true));
    editBeforeHtml = editEl.innerHTML;
    editAttr = editEl.getAttribute('contenteditable');
    editEl.setAttribute('contenteditable', 'true');
    editEl.focus();
    refreshUi();
  }
  function endEdit() {
    if (!editing) return;
    const el = editEl, before = editBeforeNodes;
    editing = false; editEl = null; editBeforeNodes = null;
    if (editAttr === null) el.removeAttribute('contenteditable'); else el.setAttribute('contenteditable', editAttr);
    if (el.innerHTML !== editBeforeHtml) {
      const after = Array.from(el.childNodes, (n) => n.cloneNode(true));
      push({
        undo: () => el.replaceChildren(...before.map((n) => n.cloneNode(true))),
        redo: () => el.replaceChildren(...after.map((n) => n.cloneNode(true)))
      });
    }
    refreshUi();
  }

  // ---------- element actions ----------
  const guardRoot = () => { if (isRoot(selEl)) throw new Error('This works on elements inside the page, not the page body.'); };
  function stripIds(el) { el.removeAttribute && el.removeAttribute('id'); el.querySelectorAll && el.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id')); }

  function duplicate() {
    if (!selEl) return; guardRoot(); endEdit();
    const el = selEl, c = el.cloneNode(true);
    stripIds(c);
    el.after(c);
    push({ undo: () => c.remove(), redo: () => el.after(c) });
    select(c);
  }
  function del() {
    if (!selEl) return; guardRoot(); endEdit();
    const el = selEl, p = el.parentNode, next = el.nextSibling;
    el.remove();
    push({ undo: () => p.insertBefore(el, next), redo: () => el.remove() });
    select(null);
  }
  function move(dir) {
    if (!selEl) return; guardRoot(); endEdit();
    const el = selEl, p = el.parentNode, origNext = el.nextSibling;
    const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) { toast('Nothing to swap with.'); return; }
    const before = dir < 0 ? sib : sib.nextSibling;
    p.insertBefore(el, before);
    push({ undo: () => p.insertBefore(el, origNext), redo: () => p.insertBefore(el, before) });
  }
  function fontStep(d) {
    if (!selEl) return;
    const el = selEl, old = el.style.fontSize;
    const nv = Math.max(6, (parseFloat(getComputedStyle(el).fontSize) || 16) + d) + 'px';
    el.style.fontSize = nv;
    push({ undo: () => { el.style.fontSize = old; }, redo: () => { el.style.fontSize = nv; } });
  }

  // ---------- images ----------
  function imageFromUrl() {
    const u = window.prompt('Paste an image URL (https://...)');
    if (u && u.trim()) applyImage(u.trim());
  }
  function applyImage(url) {
    const t = imgTarget(selEl);
    if (!t) { toast('No image in this selection.'); return; }
    if (t.tagName === 'IMG') {
      const old = { src: t.getAttribute('src'), srcset: t.getAttribute('srcset'), sizes: t.getAttribute('sizes') };
      const pic = t.parentElement && t.parentElement.tagName === 'PICTURE' ? t.parentElement : null;
      const sources = pic ? [...pic.querySelectorAll('source')] : [];
      const doIt = () => { sources.forEach((s) => s.remove()); t.removeAttribute('srcset'); t.removeAttribute('sizes'); t.src = url; };
      const undoIt = () => {
        sources.forEach((s) => pic.insertBefore(s, t));
        for (const [k, v] of Object.entries(old)) { if (v === null) t.removeAttribute(k); else t.setAttribute(k, v); }
      };
      doIt(); push({ undo: undoIt, redo: doIt });
    } else {
      const old = t.style.backgroundImage, nv = 'url("' + url.replace(/"/g, '%22') + '")';
      t.style.backgroundImage = nv;
      push({ undo: () => { t.style.backgroundImage = old; }, redo: () => { t.style.backgroundImage = nv; } });
    }
    schedule();
  }

  // ---------- raw HTML ----------
  function openHtml() {
    if (!selEl) return; guardRoot(); endEdit();
    ui.ta.value = selEl.outerHTML;
    ui.modal.style.display = 'flex';
    ui.ta.focus();
  }
  function applyHtml() {
    const el = selEl;
    try {
      const t = document.createElement('template');
      t.innerHTML = ui.ta.value;
      const nodes = [...t.content.childNodes];
      if (!nodes.length) throw new Error('HTML is empty.');
      el.replaceWith(...nodes);
      push({ undo: () => { nodes[0].before(el); nodes.forEach((n) => n.remove()); }, redo: () => el.replaceWith(...nodes) });
      ui.modal.style.display = 'none';
      select(nodes.find((n) => n.nodeType === 1) || null);
    } catch (e) {
      toast('Could not apply HTML: ' + e.message + ' (this site may block HTML injection)');
    }
  }

  // ---------- page events ----------
  function onMove(e) {
    if (ours(e)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    hoverEl = el && el !== host && el !== document.documentElement ? el : null;
    schedule();
  }
  function onBlock(e) {
    if (ours(e)) return;
    if (editing && editEl.contains(e.target)) {
      if (e.type === 'click' && e.target.closest && e.target.closest('a')) e.preventDefault();
      return; // let the caret / selection work inside the element being edited
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') select(pick(e.clientX, e.clientY, e.altKey));
    else if (e.type === 'dblclick') { const el = pick(e.clientX, e.clientY, false); if (el && !isRoot(el)) { select(el); startEdit(); } }
  }
  function onKey(e) {
    if (ours(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editing) endEdit(); else if (selEl) select(null); else stop();
    } else if (editing) {
      return; // native typing + native undo/redo
    } else if (selEl && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault(); try { del(); } catch (err) { toast(err.message); }
    } else if (mod && e.key.toLowerCase() === 'd' && selEl) {
      e.preventDefault(); try { duplicate(); } catch (err) { toast(err.message); }
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault(); e.shiftKey ? redo() : undo();
    }
  }

  function start() {
    on = true;
    buildUi();
    BLOCK.forEach((t) => document.addEventListener(t, onBlock, true));
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('input', schedule, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    refreshUi();
    notify();
  }
  function stop() {
    endEdit();
    on = false;
    BLOCK.forEach((t) => document.removeEventListener(t, onBlock, true));
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('input', schedule, true);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    host?.remove(); host = root = null; ui = {};
    hoverEl = selEl = null; stack = []; hist = []; redoStack = [];
    notify();
    return false;
  }
  function toggle() { if (on) stop(); else start(); return on; }

  window[KEY] = { toggle };
  return toggle();
})();
