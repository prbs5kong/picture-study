/* Static (no-server) version of the picture-study survey, IRB 26-0555, B2 (11-22). Built by build_static.py.
   Ports the hosted app's flow (study_logic.Engine) and page rendering (app.render_page) to the browser.
   Nothing is sent anywhere. Answers stay in this tab (sessionStorage) until the participant chooses
   "Yes, use my answers"; the end page then offers ONE file, ps_<code>.json, in the app's kept-file schema.
   Every storage call is wrapped in try/catch; the survey still runs when storage is blocked. */
(function () {
  'use strict';
  var D = window.PS_DATA;
  var KEY = { state: 'ps_state', kept: 'ps_kept', done: 'ps_done' };
  var root = document.getElementById('app');
  var S = null;        // the response in progress
  var KEPT = null;     // the kept file (after "Yes, use my answers")
  var TE = {};
  D.text_entry.forEach(function (x) { TE[x[0] + '|' + x[1]] = x[2]; });

  // ---- storage (try/catch everywhere) ----
  function sget(st, k) { try { var v = window[st].getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sset(st, k, v) { try { window[st].setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function sdel(st, k) { try { window[st].removeItem(k); } catch (e) { /* storage blocked */ } }
  function clearAll() {
    ['sessionStorage', 'localStorage'].forEach(function (st) {
      try {
        var s = window[st], ks = [];
        for (var i = 0; i < s.length; i++) { ks.push(s.key(i)); }
        ks.forEach(function (k) { if (k && k.indexOf('ps_') === 0) { s.removeItem(k); } });
      } catch (e) { /* storage blocked */ }
    });
  }
  function save() { if (S) { sset('sessionStorage', KEY.state, S); } }

  // ---- helpers ----
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
  function randHex(nBytes) {
    var a = new Uint8Array(nBytes);
    (window.crypto || window.msCrypto).getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) { s += ('0' + a[i].toString(16)).slice(-2); }
    return s;
  }
  function randVersion() {      // a static page cannot count, so each start draws 1 or 2 with equal chance
    var a = new Uint8Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return (a[0] & 1) ? '2' : '1';
  }
  function closed() { return Date.now() >= D.close_at_ms; }
  function path(v) {
    var mid = v ? D.vblocks.map(function (b) { return 'V' + v + '_' + b; }) : [];
    return D.pre.concat(mid, D.post);
  }
  function nPages(v) { return path(v).reduce(function (s, b) { return s + D.blocks[b].length; }, 0); }
  function progress() {
    var p = path(S.version), done = 0;
    for (var i = 0; i < p.length; i++) {
      if (p[i] === S.block) { done += S.page; break; }
      done += D.blocks[p[i]].length;
    }
    return Math.floor(100 * done / nPages(S.version || '1'));
  }
  function first(x) { return Array.isArray(x) ? x[0] : x; }
  function resetLink() { return '<p class="rst"><a href="#" id="rst">Reset survey</a></p>'; }

  // ---- rendering (app.render_question / app.render_page) ----
  function renderQuestion(q, prev, errors) {
    var tag = q.id, out = [], attrs = '';
    if (D.display_if[tag]) { attrs = ' data-showif="' + D.display_if[tag][0] + ':' + D.display_if[tag][1].join(',') + '"'; }
    out.push('<div class="q" id="q_' + tag + '"' + attrs + '>');
    if (errors[tag]) { out.push('<div class="err">' + esc(errors[tag]) + '</div>'); }
    out.push(q.html);
    if (q.type === 'MC') {
      var multi = q.sel === 'MultipleAnswer';
      var pv = prev[tag], sel = Array.isArray(pv) ? pv : String(pv || '').split(',');
      out.push('<div class="ch' + (q.layout === 'Horizontal' ? ' h' : '') + '">');
      q.choices.forEach(function (c) {
        var code = c[0], text = c[1], cid = tag + '_' + code;
        var ex = D.exclusive[tag] === code ? ' data-excl="1"' : '';
        var chk = sel.indexOf(code) >= 0 ? ' checked' : '';
        var te = '', tt = TE[tag + '|' + code];
        if (tt) {
          te = ' <input type="text" name="' + tt + '" data-for="' + cid + '" value="' + esc(first(prev[tt]) || '') +
            '" aria-label="' + esc(text) + '" maxlength="' + D.max_text + '">';
        }
        out.push('<label><input type="' + (multi ? 'checkbox' : 'radio') + '" id="' + cid + '" name="' + tag +
          '" value="' + code + '"' + chk + ex + '> <span>' + text + '</span>' + te + '</label>');
      });
      out.push('</div>');
    } else if (q.type === 'TE') {
      out.push('<textarea name="' + tag + '" maxlength="' + D.max_text + '">' + esc(first(prev[tag]) || '') + '</textarea>');
    }
    out.push('</div>');
    return out.join('');
  }

  function show(questions, prog, prev, errors, onNext) {
    var body = ['<div class="prog" role="progressbar" aria-valuenow="' + prog + '" aria-valuemin="0" aria-valuemax="100">' +
      '<div style="width:' + prog + '%"></div></div>', '<form id="fk" autocomplete="off">'];
    questions.forEach(function (q) { body.push(renderQuestion(q, prev || {}, errors || {})); });
    body.push('<div class="nav"><button type="submit">Next</button></div></form>');
    body.push(resetLink());
    root.innerHTML = body.join('');
    var f = document.getElementById('fk');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = f.querySelector('button');
      if (b.disabled) { return; }
      b.disabled = true;
      onNext(readForm(f));
    });
    wire();
    window.scrollTo(0, 0);
  }

  function wire() {     // app.JS: exclusive answer, text entry selects its choice, in-page display logic
    function upd() {
      Array.prototype.forEach.call(document.querySelectorAll('[data-showif]'), function (q) {
        var p = q.getAttribute('data-showif').split(':'), need = p[1].split(','), on = false;
        Array.prototype.forEach.call(document.querySelectorAll('input[name="' + p[0] + '"]'), function (i) {
          if (i.checked && need.indexOf(i.value) >= 0) { on = true; }
        });
        q.style.display = on ? '' : 'none';
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('input[data-excl]'), function (x) {
      var others = document.querySelectorAll('input[type=checkbox][name="' + x.name + '"]');
      x.addEventListener('change', function () {
        if (x.checked) { Array.prototype.forEach.call(others, function (o) { if (o !== x) { o.checked = false; } }); }
      });
      Array.prototype.forEach.call(others, function (o) {
        if (o !== x) { o.addEventListener('change', function () { if (o.checked) { x.checked = false; } upd(); }); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[data-for]'), function (t) {
      t.addEventListener('input', function () {
        if (t.value.trim()) {
          var c = document.getElementById(t.getAttribute('data-for'));
          if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); }
        }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input'), function (i) { i.addEventListener('change', upd); });
    upd();
    var r = document.getElementById('rst');
    if (r) { r.addEventListener('click', function (ev) { ev.preventDefault(); reset(); }); }
  }

  function readForm(f) {        // like a posted form: name -> list of values
    var form = {};
    Array.prototype.forEach.call(f.querySelectorAll('input, textarea'), function (el) {
      if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) { return; }
      (form[el.name] = form[el.name] || []).push(el.value);
    });
    return form;
  }

  // ---- answers (study_logic.Engine._read) ----
  function readQ(q, form, answers, errors) {
    var tag = q.id, codes = q.choices.map(function (c) { return c[0]; });
    if (q.type === 'TE') {
      var t = first(form[tag]);
      if (t) { answers[tag] = String(t).slice(0, D.max_text); }
      return;
    }
    var vals = (form[tag] || []).map(String).filter(function (v) { return codes.indexOf(v) >= 0; });
    var texts = {};
    codes.forEach(function (c) {
      var tt = TE[tag + '|' + c];
      if (tt) {
        var t2 = first(form[tt]);
        if (t2 && String(t2).trim()) {
          texts[c] = [tt, String(t2).slice(0, D.max_text)];
          if (vals.indexOf(c) < 0 && (q.sel === 'MultipleAnswer' || !vals.length)) { vals.push(c); }
        }
      }
    });
    if (q.sel !== 'MultipleAnswer') { vals = vals.slice(0, 1); }
    var ex = D.exclusive[tag];
    if (ex && vals.indexOf(ex) >= 0 && vals.length > 1) {
      errors[tag] = '"None of these" cannot be combined with another answer.';
      return;
    }
    if (!vals.length) {
      if (D.force.indexOf(tag) >= 0) { errors[tag] = D.force_msg; }
      return;
    }
    vals = vals.filter(function (v, i) { return vals.indexOf(v) === i; })
      .sort(function (x, y) { return parseInt(x, 10) - parseInt(y, 10); });
    answers[tag] = vals.join(',');
    Object.keys(texts).forEach(function (c) { if (vals.indexOf(c) >= 0) { answers[texts[c][0]] = texts[c][1]; } });
  }

  function submit(form) {
    var qs = D.blocks[S.block][S.page], got = {}, errors = {}, nerr = 0;
    qs.forEach(function (q) {
      if (q.type === 'Text') { return; }
      if (D.display_if[q.id]) {
        var src = D.display_if[q.id][0], need = D.display_if[q.id][1];
        var shown = String(got[src] || '').split(',').some(function (v) { return need.indexOf(v) >= 0; });
        if (!shown) { return; }
      }
      readQ(q, form, got, errors);
    });
    Object.keys(errors).forEach(function () { nerr++; });
    if (nerr) { show(qs, progress(), form, errors, submit); return; }
    Object.keys(got).forEach(function (k) { S.answers[k] = got[k]; });
    advance();
  }

  // ---- flow (study_logic.Engine._advance) ----
  function advance() {
    var a = S.answers, blk = S.block, endName = null;
    if (S.page + 1 < D.blocks[blk].length) { S.page += 1; S.step += 1; save(); current(); return; }
    if (blk === 'ELIGIBILITY' && a.ELIG === '2') {
      endName = 'END_INELIGIBLE';
    } else if (blk === 'CONSENT') {
      if (a.CONSENT === '2') { endName = 'END_DECLINED'; } else if (closed()) { endName = 'END_CLOSED'; }
    } else if (blk === 'INSTRUCTIONS') {
      S.version = randVersion();
      S.answers.version = S.version;      // embedded data field `version`
    } else if (blk === 'DEBRIEFING') {
      if (a.DEBRIEF_USE === '2') { endName = 'END_REMOVED'; } else { keep(); return; }
    }
    if (endName) { finish(endName); return; }
    var p = path(S.version);
    S.block = p[p.indexOf(blk) + 1];
    S.page = 0;
    S.step += 1;
    save();
    current();
  }

  function keep() {           // study_logic.Store.keep, same fields and order
    KEPT = { code: S.code, version: S.version, answers: S.answers,
      duration_s: Math.round((Date.now() - S.t0) / 1000), progress: 100, finished: true, keep: 'yes',
      kept_order: 1, format: D.format };
    sset('sessionStorage', KEY.kept, KEPT);
    finish('END_THANKS');
  }

  function finish(name) {
    S = null;
    sdel('sessionStorage', KEY.state);
    if (name !== 'END_FULL' && name !== 'END_CLOSED') { sset('localStorage', KEY.done, 1); }
    endPage(name);
  }

  function current() { show(D.blocks[S.block][S.page], progress(), null, null, submit); }

  // ---- end pages ----
  function endPage(name) {
    if (name === 'END_THANKS' && KEPT) { thanksPage(); return; }
    root.innerHTML = '<div class="end"><p>' + esc(D.end[name]) + '</p></div>' + resetLink();
    wire();
    window.scrollTo(0, 0);
  }

  function fileText() { return JSON.stringify(KEPT, null, 1); }
  function fileName() { return 'ps_' + KEPT.code + '.json'; }

  function thanksPage() {
    root.innerHTML =
      '<div class="end">' +
      '<p><button type="button" id="dl" class="big">Download my answers</button></p>' +
      '<p class="mail">' + esc(D.email_line) + '</p>' +
      '<p>' + esc(D.end.END_THANKS) + '</p>' +
      '<p>The file is named <b>' + esc(fileName()) + '</b>.</p>' +
      '<div class="cp"><p><b>If the download does not work:</b> copy the text below and paste it into your email.</p>' +
      '<textarea id="cpbox" readonly></textarea>' +
      '<p><button type="button" id="cpbtn">Copy my answers</button> <span id="cpmsg"></span></p></div>' +
      '<p style="margin-top:30px"><button type="button" id="rstbtn" class="reset">Reset survey</button></p>' +
      '</div>';
    document.getElementById('cpbox').value = fileText();
    document.getElementById('dl').addEventListener('click', download);
    document.getElementById('cpbtn').addEventListener('click', copyText);
    document.getElementById('rstbtn').addEventListener('click', reset);
    window.scrollTo(0, 0);
  }

  function download() {
    var txt = fileText(), name = fileName();
    try {
      var blob = new Blob([txt], { type: 'application/json' });
      if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, name); return; }
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 4000);
    } catch (e) {
      var m = document.getElementById('cpmsg');
      if (m) { m.textContent = 'The download did not start. Please use Copy my answers.'; }
    }
  }

  function copyText() {
    var box = document.getElementById('cpbox'), m = document.getElementById('cpmsg'), ok = false;
    box.focus();
    box.select();
    try { box.setSelectionRange(0, box.value.length); } catch (e) { /* old browsers */ }
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(function () { m.textContent = 'Copied.'; },
        function () { m.textContent = 'Please select the text and copy it.'; });
      return;
    }
    m.textContent = ok ? 'Copied.' : 'Please select the text and copy it.';
  }

  // ---- reset ----
  function reset() {
    if (!window.confirm(D.reset_confirm)) { return; }
    S = null;
    KEPT = null;
    clearAll();
    root.innerHTML = '';
    window.location.href = window.location.href.split('#')[0];
  }

  // ---- start ----
  function welcome() {
    show(D.blocks.WELCOME[0], 0, null, null, function () {
      if (sget('localStorage', KEY.done)) { endPage('REPEAT_VISIT'); return; }
      if (closed()) { endPage('END_CLOSED'); return; }
      S = { code: randHex(8), version: null, block: 'ELIGIBILITY', page: 0, step: 1, answers: {}, t0: Date.now() };
      save();
      current();
    });
  }

  function boot() {
    S = sget('sessionStorage', KEY.state);
    KEPT = sget('sessionStorage', KEY.kept);
    if (S && S.block && D.blocks[S.block]) { current(); return; }
    S = null;
    if (KEPT) { thanksPage(); return; }        // a reload of the end page keeps the download
    if (sget('localStorage', KEY.done)) { endPage('REPEAT_VISIT'); return; }
    if (closed()) { endPage('END_CLOSED'); return; }
    welcome();
  }
  boot();
}());
