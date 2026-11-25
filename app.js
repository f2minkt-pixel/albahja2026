/* Al Bahja portal — front end. Talks to Google Apps Script (live) or demo.js (demo). */
(function () {
  'use strict';
  var CFG = window.AB_CONFIG || {}, DEMO = !CFG.API_URL, REFRESH = (CFG.REFRESH_SECONDS || 15) * 1000;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var view = $('#view');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function opts(list, sel, all) {
    return (all ? '<option value="">' + esc(all) + '</option>' : '') +
      list.map(function (x) { var v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
  }
  function progOpts(sel, all) {
    return (all ? '<option value="">' + esc(all) + '</option>' : '') +
      '<optgroup label="Sports (Boys)">' + opts(AB.SPORTS, sel) + '</optgroup>' +
      '<optgroup label="Arts – Boys">' + opts(AB.ARTS_BOYS, sel) + '</optgroup>' +
      '<optgroup label="Arts – Girls only">' + opts(AB.ARTS_GIRLS.filter(function (x) { return AB.ARTS_BOYS.indexOf(x) < 0; }), sel) + '</optgroup>';
  }
  if (DEMO) $('#demoBar').hidden = false;

  // ---------- storage & sessions ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('ab_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('ab_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  var sessions = store.get('sessions', {});
  function setSession(role, s) { if (s) sessions[role] = s; else delete sessions[role]; store.set('sessions', sessions); }
  function sessFor(role) { return sessions[role] || sessions.admin || null; }

  // ---------- api ----------
  function api(action, params) {
    var body = Object.assign({ action: action }, params || {});
    if (DEMO) return new Promise(function (res) { setTimeout(function () { res(window.ABDemo.call(action, body)); }, 120); });
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Could not reach the server. Check your internet connection and try again.' }; });
  }
  function toast(msg, bad) {
    var d = document.createElement('div'); d.textContent = msg; if (bad) d.className = 'bad';
    $('#toast').appendChild(d); setTimeout(function () { d.remove(); }, 3800);
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + (label || 'Saving…'); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }

  var D = null; // last portal data
  function loadData(sess) {
    return api('data', { token: sess.token }).then(function (r) {
      if (!r.ok) {
        if (r.auth) { setSession(sess.role, null); toast(r.error, true); route(); }
        else toast(r.error, true);
        return null;
      }
      D = r; return r;
    });
  }

  // ---------- small components ----------
  function ci(chest, st) {
    var on = st === AB.PRESENT;
    return '<span class="ci ' + (on ? 'in' : 'out') + '" data-ci="' + esc(chest) + '">' + (on ? 'Present' : 'Not Present') + '</span>';
  }
  function stIdx(s) { return Math.max(0, AB.SCREENING.indexOf(s)); }
  function stPill(s) { return '<span class="pill st-' + stIdx(s) + '">' + esc(s) + '</span>'; }
  function catPill(c) { return '<span class="pill cat-' + esc(c) + '">' + esc(c) + '</span>'; }
  function shortGroup(g) { return String(g || '').replace(/\s*\(.*\)/, ''); }
  function checkinOf(chest) {
    var r = (D && D.registrations || []).filter(function (x) { return String(x.chest) === String(chest); })[0];
    if (r) return r.checkin;
    var a = (D && D.assignments || []).filter(function (x) { return String(x.chest) === String(chest); })[0];
    return a ? a.checkin : AB.ABSENT;
  }
  function updateBadges() {
    $$('[data-ci]').forEach(function (el) {
      var on = checkinOf(el.dataset.ci) === AB.PRESENT;
      el.className = 'ci ' + (on ? 'in' : 'out'); el.textContent = on ? 'Present' : 'Not Present';
    });
  }
  function editingIn(el) {
    var a = document.activeElement;
    return !!(el && a && el.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) || !!$('.modal');
  }
  var ICON = {
    teacher: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/></svg>',
    volunteer: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    judge: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    admin: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>'
  };

  function head(eyebrow, title, sub, sess) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h2>' + title + '</h2>' +
      (sub ? '<p class="muted small">' + sub + '</p>' : '') + '</div>' +
      (sess ? '<div class="whoami">Signed in as <b>' + esc(sess.name) + '</b>' + (sess.role === 'admin' ? ' <span class="pill st-3">Admin</span>' : '') +
        '<button class="btn sm ghost" data-logout="' + esc(sess.role) + '">Log out</button></div>' : '') + '</div>';
  }

  function loginCard(role, title, sub, fields, btnLabel) {
    view.innerHTML = '<div class="login card"><div class="lh"><div class="ico">' + ICON[role] + '</div><div><h2>' + esc(title) + '</h2><p class="muted small" style="margin:2px 0 0">' + sub + '</p></div></div>' +
      '<form id="loginForm" novalidate>' + fields + '<div id="loginErr"></div><button class="btn block" type="submit">' + esc(btnLabel || 'Continue') + '</button></form></div>';
    var f = $('#loginForm');
    var first = $('input,select', f); if (first) first.focus();
    f.onsubmit = function (e) {
      e.preventDefault();
      var p = { role: role };
      $$('[name]', f).forEach(function (el) { p[el.name] = el.value; });
      var btn = $('button[type=submit]', f); busy(btn, true, 'Checking…');
      api('login', p).then(function (r) {
        busy(btn, false);
        if (!r.ok) { $('#loginErr').innerHTML = '<div class="notice bad" style="margin:0 0 14px">' + esc(r.error) + '</div>'; return; }
        setSession(role, { token: r.token, role: r.role, name: r.name, program: r.program });
        toast('Welcome, ' + r.name);
        route();
      });
    };
  }
  function fld(label, name, attrs, hint) {
    return '<div class="field"><label class="f" for="f_' + name + '">' + label + '</label><input class="in" id="f_' + name + '" name="' + name + '" ' + (attrs || '') + '>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }

  // ---------- router ----------
  var timer = null;
  function every(fn) { clearInterval(timer); timer = setInterval(function () { if (document.visibilityState === 'visible') fn(); }, REFRESH); }
  function route() {
    var v = location.hash.replace('#', '') || 'register';
    if (!VIEWS[v]) v = 'register';
    document.body.dataset.view = v;
    $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.v === v); });
    clearInterval(timer); timer = null;
    view.onclick = view.onchange = view.oninput = view.onkeydown = null;
    VIEWS[v]();
  }
  document.addEventListener('click', function (e) {
    var lo = e.target.closest('[data-logout]');
    if (lo) { setSession(lo.dataset.logout, null); D = null; toast('Logged out'); route(); }
  });
  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });

  // =====================================================================
  // 1. REGISTRATION
  // =====================================================================
  var R = freshReg();
  function freshReg() { return { step: 1, name: '', gender: '', phone: '', cls: '', group: '', sports: [], arts: [], err: {}, receipt: null }; }

  function hero() {
    return '';
  }

  function viewRegister() {
    if (R.step === 4 && R.receipt) return renderReceipt();
    var steps = [['1', 'Student details'], ['2', 'Choose items'], ['3', 'Review & submit']];
    view.innerHTML = hero() + '<section class="card" id="regCard" style="max-width:860px;margin:0 auto">' +
      '<div class="steps">' + steps.map(function (s, i) {
        var n = i + 1; return '<div data-n="' + s[0] + '" class="' + (R.step === n ? 'on' : R.step > n ? 'done' : '') + '"><span>' + s[1] + '</span></div>';
      }).join('') + '</div><div id="stepBody"></div></section>';
    paintStep();
    view.onclick = regClick;
    view.oninput = function (e) {
      var t = e.target;
      if (t.name && ['name', 'phone', 'cls', 'group'].indexOf(t.name) >= 0) { R[t.name] = t.value; if (R.err[t.name]) { delete R.err[t.name]; t.classList.remove('err'); var er = t.parentNode.querySelector('.errtxt'); if (er) er.remove(); } }
    };
    view.onchange = function (e) {
      var t = e.target;
      if (t.name === 'cls' || t.name === 'group') R[t.name] = t.value;
      if (t.dataset.item) {
        var arr = R[t.dataset.cat];
        if (t.checked && arr.length < AB.MAX_PER_CATEGORY && arr.indexOf(t.dataset.item) < 0) arr.push(t.dataset.item);
        if (!t.checked) R[t.dataset.cat] = arr.filter(function (x) { return x !== t.dataset.item; });
        delete R.err.items;
        paintStep();
      }
    };
  }

  function errMsg(k) { return R.err[k] ? '<div class="errtxt">' + esc(R.err[k]) + '</div>' : ''; }
  function paintStep() {
    var b = $('#stepBody'); if (!b) return;
    if (R.step === 1) {
      b.innerHTML =
        '<div class="field"><label class="f" for="r_name">Full name <em>*</em></label><input class="in' + (R.err.name ? ' err' : '') + '" id="r_name" name="name" autocomplete="name" value="' + esc(R.name) + '" placeholder="e.g. Fathima Rahman">' + (errMsg('name') || '<div class="hint">First name and family name, as it should appear on the certificate.</div>') + '</div>' +
        '<div class="field"><span class="f" style="display:block;font-weight:600;font-size:13.5px;margin-bottom:6px">Gender <em style="color:var(--bad);font-style:normal">*</em></span><div class="seg big" role="radiogroup">' +
        AB.GENDERS.map(function (g) { return '<button type="button" role="radio" aria-checked="' + (R.gender === g) + '" data-gender="' + g + '" class="' + (R.gender === g ? 'on' : '') + '">' + g + '</button>'; }).join('') + '</div>' + errMsg('gender') + '</div>' +
        '<div class="field"><label class="f" for="r_phone">Parent\'s phone number <em>*</em></label><input class="in' + (R.err.phone ? ' err' : '') + '" id="r_phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(R.phone) + '" placeholder="05XXXXXXXX">' + (errMsg('phone') || '<div class="hint">Saudi mobile (05XXXXXXXX) or international number with country code.</div>') + '</div>' +
        '<div class="grid2"><div class="field"><label class="f" for="r_cls">Class in Madrasa <em>*</em></label><select class="in' + (R.err.cls ? ' err' : '') + '" id="r_cls" name="cls">' + opts(AB.CLASSES, R.cls, 'Select class') + '</select>' + errMsg('cls') + '</div>' +
        '<div class="field"><label class="f" for="r_group">Age group <em>*</em></label><select class="in' + (R.err.group ? ' err' : '') + '" id="r_group" name="group">' + opts(AB.GROUPS, R.group, 'Select age group') + '</select>' + errMsg('group') + '</div></div>' +
        '<div class="formnav"><span></span><button class="btn" data-next="2">Next: choose items →</button></div>';
    } else if (R.step === 2) {
      var html = '';
      if (R.gender === 'Boys') html += pickSection('sports', 'Sports items', AB.SPORTS);
      else html += '<div class="notice info" style="margin-top:0">Sports items are for boys only — girls can choose from the Arts items below.</div>';
      html += pickSection('arts', 'Arts items', R.gender === 'Boys' ? AB.ARTS_BOYS : AB.ARTS_GIRLS);
      if (R.err.items) html += '<div class="notice bad">' + esc(R.err.items) + '</div>';
      html += '<div class="formnav"><button class="btn ghost" data-next="1">← Back</button><button class="btn" data-next="3">Next: review →</button></div>';
      b.innerHTML = html;
    } else if (R.step === 3) {
      b.innerHTML = '<div class="review"><h3 style="margin-bottom:14px">Check the details before submitting</h3><dl>' +
        '<dt>Full name</dt><dd>' + esc(R.name) + '</dd><dt>Gender</dt><dd>' + esc(R.gender) + '</dd>' +
        '<dt>Parent\'s phone</dt><dd>' + esc(R.phone) + '</dd><dt>Class</dt><dd>' + esc(R.cls) + '</dd><dt>Age group</dt><dd>' + esc(R.group) + '</dd>' +
        (R.gender === 'Boys' ? '<dt>Sports items</dt><dd>' + (esc(R.sports.join(', ')) || '<span class="muted">None</span>') + '</dd>' : '') +
        '<dt>Arts items</dt><dd>' + (esc(R.arts.join(', ')) || '<span class="muted">None</span>') + '</dd></dl></div>' +
        '<div id="submitErr"></div>' +
        '<div class="formnav"><button class="btn ghost" data-next="2">← Edit items</button><button class="btn gold" id="submitReg">Submit registration</button></div>';
    }
  }
  function pickSection(cat, title, list) {
    var sel = R[cat], full = sel.length >= AB.MAX_PER_CATEGORY;
    return '<div class="cathead"><h3>' + title + ' ' + catPill(cat === 'sports' ? 'Sports' : 'Arts') + '</h3><span class="counter' + (full ? ' full' : '') + '">' + sel.length + ' / ' + AB.MAX_PER_CATEGORY + ' selected</span></div>' +
      '<div class="picks">' + list.map(function (it) {
        var on = sel.indexOf(it) >= 0, off = !on && full;
        return '<label class="pick' + (on ? ' on' : '') + (off ? ' off' : '') + '"><input type="checkbox" data-cat="' + cat + '" data-item="' + esc(it) + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '>' + esc(it) + '</label>';
      }).join('') + '</div>' +
      (full ? '<div class="notice warn">Maximum of 3 ' + (cat === 'sports' ? 'Sports' : 'Arts') + ' items reached. Untick one to choose a different item.</div>'
        : '<div class="hint">Choose up to 3.</div>');
  }
  function validateStep1() {
    var e = {};
    if (!AB.isFullName(R.name)) e.name = 'Please enter the full name — first name and family name (at least 2 words).';
    if (!R.gender) e.gender = 'Please choose Boys or Girls.';
    var ph = R.phone.replace(/\D/g, '');
    if (!/^\d{9,15}$/.test(ph)) e.phone = 'Enter a valid phone number (9–15 digits).';
    if (!R.cls) e.cls = 'Please choose the class.';
    if (!R.group) e.group = 'Please choose the age group.';
    R.err = e; return !Object.keys(e).length;
  }
  function regClick(e) {
    var g = e.target.closest('[data-gender]');
    if (g) {
      R.gender = g.dataset.gender;
      if (R.gender === 'Girls') { R.sports = []; R.arts = R.arts.filter(function (x) { return AB.ARTS_GIRLS.indexOf(x) >= 0; }); }
      delete R.err.gender; paintStep(); return;
    }
    var n = e.target.closest('[data-next]');
    if (n) {
      var to = Number(n.dataset.next);
      if (to > R.step && R.step === 1 && !validateStep1()) { paintStep(); var bad = $('.in.err', view); if (bad) bad.focus(); return; }
      if (to > R.step && R.step === 2 && !R.sports.length && !R.arts.length) { R.err.items = 'Please select at least one item.'; paintStep(); return; }
      R.step = to; viewRegister(); $('#regCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    if (e.target.closest('#submitReg')) {
      var btn = $('#submitReg'); busy(btn, true, 'Submitting…');
      api('register', { name: R.name, gender: R.gender, phone: R.phone, cls: R.cls, group: R.group, sports: R.sports, arts: R.arts }).then(function (r) {
        busy(btn, false);
        if (!r.ok) { $('#submitErr').innerHTML = '<div class="notice bad">' + esc(r.error) + '</div>'; return; }
        R.receipt = r.receipt; R.emailed = r.emailed; R.step = 4; viewRegister(); window.scrollTo(0, 0);
      });
    }
  }
  function renderReceipt() {
    var g = R.receipt.reg, en = R.receipt.entries;
    view.innerHTML = '<div class="pass" id="pass"><div class="ph"><img src="assets/logo.png" alt=""><div><span>Registration pass</span><b>Al Bahja Madrasa Meet \'26</b></div></div>' +
      '<div class="big"><div><div style="font-size:20px;font-weight:700">' + esc(g.name) + '</div><div class="muted small">' + esc(g.gender) + ' · ' + esc(g.cls) + '<br>' + esc(g.group) + '</div></div>' +
      '<div class="no"><small>Chest No</small><b>' + esc(g.chest) + '</b></div></div>' +
      '<div class="body"><div class="small muted">Registered items — each has its own entry number</div><div class="entries">' +
      en.map(function (x) { return '<div><code>' + esc(x.entry) + '</code><span class="grow">' + esc(x.program) + '</span>' + catPill(x.category) + '</div>'; }).join('') + '</div></div>' +
      '<div class="foot">Parent phone: ' + esc(g.phone) + ' · Registered ' + esc(g.ts) + '<br>Fri, 4 Dec 2026 · Saihat Istiraha, Dhahran–Jubail Highway. Please show this pass at the check-in desk.' +
      (R.emailed === false ? '<br><b style="color:var(--bad)">Saved, but the email copy could not be sent.</b>' : '') + '</div></div>' +
      '<div class="row noprint" style="justify-content:center;margin-top:18px">' +
      '<button class="btn ghost" id="printPass">Print pass</button>' +
      '<button class="btn gold" id="savePass">Save pass</button>' +
      '<button class="btn" id="another">Register another student</button></div>';
    view.onclick = function (e) {
      if (e.target.closest('#printPass')) window.print();
      if (e.target.closest('#savePass')) savePassImage(e.target.closest('#savePass'), g);
      if (e.target.closest('#another')) { R = freshReg(); viewRegister(); window.scrollTo(0, 0); }
    };
  }

  /** Downloads the pass as a PNG image (html2canvas is loaded only when needed). */
  var h2cLoading = null;
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve();
    return h2cLoading || (h2cLoading = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = ok; s.onerror = function () { h2cLoading = null; fail(); };
      document.head.appendChild(s);
    }));
  }
  function savePassImage(btn, g) {
    busy(btn, true, 'Saving…');
    var frame;
    loadH2C().then(function () {
      // Copy the pass into an off-screen white frame so the image has blank space around it, like the preview.
      frame = document.createElement('div');
      frame.className = 'pass-frame';
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;padding:40px;background:#ffffff';
      var copy = $('#pass').cloneNode(true);
      copy.removeAttribute('id');
      frame.appendChild(copy);
      document.body.appendChild(frame);
      return window.html2canvas(frame, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 720,
        onclone: function (doc) {
          // html2canvas paints soft shadows as grey blocks: use a thin border instead; notches match the white frame.
          var st = doc.createElement('style');
          st.textContent = '.pass-frame .pass{box-shadow:none!important;margin:0 auto!important;border:1.5px solid #E2E6DF}' +
            '.pass-frame .pass .big::before,.pass-frame .pass .big::after{background:#ffffff!important;border:1.5px solid #E2E6DF}' +
            '.pass-frame .pass .big::before{left:-13px!important}.pass-frame .pass .big::after{right:-13px!important}' +
            '.pass-frame .pass .entries div{display:block!important;line-height:22px;padding:9px 12px 11px!important;overflow:hidden}' +
            '.pass-frame .pass .entries code{display:inline-block;width:80px}.pass-frame .pass .entries .pill{float:right;line-height:18px}';
          doc.head.appendChild(st);
        } });
    }).then(function (canvas) {
      if (frame) frame.remove();
      canvas.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'AlBahja-Pass-Chest-' + g.chest + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        busy(btn, false); toast('Pass saved as an image');
      }, 'image/png');
    }).catch(function () {
      if (frame) frame.remove();
      busy(btn, false); toast('Could not save the image — use Print pass and choose "Save as PDF".', true);
    });
  }

  // =====================================================================
  // 2. LIVE SCOREBOARD (public)
  // =====================================================================
  var SB = { cat: '', gender: '', group: '', program: '', results: null, at: '' };
  function viewScoreboard() {
    view.innerHTML = '<div class="page-head"><div><div class="eyebrow">Public results</div><h2>Live Scoreboard</h2><p class="muted small">Top 3 in every program, updating as judges submit marks.</p></div>' +
      '<div class="live"><i></i><span id="sbAt">Live</span></div></div>' +
      '<div class="toolbar" style="grid-template-columns:repeat(4,1fr)">' +
      '<select class="in" data-f="cat">' + opts(['Arts', 'Sports'], SB.cat, 'All categories') + '</select>' +
      '<select class="in" data-f="gender">' + opts(AB.GENDERS, SB.gender, 'Boys & Girls') + '</select>' +
      '<select class="in" data-f="group">' + opts(AB.GROUPS, SB.group, 'All age groups') + '</select>' +
      '<select class="in" data-f="program">' + progOpts(SB.program, 'All programs') + '</select></div>' +
      '<div id="sbBody"><div class="loading"><span class="spin dark"></span></div></div>';
    view.onchange = function (e) { var f = e.target.dataset.f; if (f) { SB[f] = e.target.value; paintScoreboard(); } };
    fetchScoreboard(); every(fetchScoreboard);
  }
  function fetchScoreboard() {
    return api('scoreboard').then(function (r) {
      if (!r.ok) { toast(r.error, true); return; }
      SB.results = r.results; SB.at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      paintScoreboard();
    });
  }
  function paintScoreboard() {
    var b = $('#sbBody'); if (!b || !SB.results) return;
    $('#sbAt').textContent = 'Live · updated ' + SB.at;
    var res = SB.results.filter(function (x) {
      return (!SB.cat || x.category === SB.cat) && (!SB.gender || x.gender === SB.gender) && (!SB.group || x.group === SB.group) && (!SB.program || x.program === SB.program);
    });
    if (!res.length) { b.innerHTML = '<div class="empty">No results yet for this selection. Results appear here as soon as judges submit marks.</div>'; return; }
    var cb = AB.classBoard(res), stars = AB.starBoard(res).slice(0, 8), max = cb.length ? cb[0].points : 1;
    b.innerHTML = '<div class="boards">' + res.map(function (x) {
      return '<article class="board"><div class="bh"><b>' + esc(x.program) + '</b><div class="meta">' + catPill(x.category) + '<span class="pill">' + esc(x.gender) + '</span><span class="pill">' + esc(x.group) + '</span></div></div>' +
        '<div class="podium">' + x.entries.map(function (e) {
          return '<div class="place"><span class="medal m' + e.rank + '">' + e.rank + '</span><div class="nm"><b>' + esc(e.name) + '</b><span>Chest ' + esc(e.chest) + ' · ' + esc(e.cls) + ' · ' + esc(shortGroup(e.group)) + '</span></div>' +
            '<div class="sc">' + e.avg + '<small>' + (e.judges > 1 ? 'avg of ' + e.judges + ' · total ' + e.total : 'score') + '</small></div></div>';
        }).join('') + '</div></article>';
    }).join('') + '</div>' +
      '<div class="lb"><section class="card"><h3 style="margin-bottom:4px">Class leaderboard</h3><p class="muted small" style="margin:0 0 12px">1st = 5 pts · 2nd = 3 pts · 3rd = 1 pt' + (SB.group ? ' · ' + esc(SB.group) : '') + '</p>' +
      '<div class="tablewrap" style="box-shadow:none"><table><thead><tr><th>#</th><th>Class</th><th>1st</th><th>2nd</th><th>3rd</th><th style="text-align:right">Points</th></tr></thead><tbody>' +
      cb.map(function (c, i) {
        return '<tr><td><span class="rankno">' + (i + 1) + '</span></td><td><b>' + esc(c.cls) + '</b><div class="bar"><i style="width:' + Math.round(c.points / max * 100) + '%"></i></div></td><td>' + c.first + '</td><td>' + c.second + '</td><td>' + c.third + '</td><td class="num"><b>' + c.points + '</b></td></tr>';
      }).join('') + '</tbody></table></div></section>' +
      '<section class="card"><h3 style="margin-bottom:4px">Star performers</h3><p class="muted small" style="margin:0 0 12px">Most points across all programs</p>' +
      stars.map(function (s, i) {
        return '<div class="place"><span class="rankno">' + (i + 1) + '</span><div class="nm"><b>' + esc(s.name) + '</b><span>Chest ' + esc(s.chest) + ' · ' + esc(s.cls) + ' · ' + esc(shortGroup(s.group)) + ' · ' + esc(s.gender) + '</span></div><div class="sc">' + s.points + '<small>pts</small></div></div>';
      }).join('') + '</section></div>';
  }

  // =====================================================================
  // 3. TEACHER SCREENING
  // =====================================================================
  var T = { q: '', group: '', cls: '', gender: '', program: '', status: '' };
  function viewTeacher() {
    var s = sessFor('teacher');
    if (!s) return loginCard('teacher', 'Teacher Screening', 'Screen participants for each program. Your login is recorded.',
      fld('Teacher name', 'name', 'autocomplete="name" required') + fld('Phone number', 'phone', 'type="tel" inputmode="tel" required') +
      fld('Special access code', 'code', 'type="password" inputmode="numeric" autocomplete="off" required'), 'Open screening portal');
    view.innerHTML = head('Screening stage', 'Teacher Screening', 'Update each entry\'s status — changes save instantly to the sheet.', s) +
      '<div id="tStats" class="stats"></div>' + entryToolbar(T) + '<p class="count" id="tCount"></p><div class="list" id="tList"><div class="loading"><span class="spin dark"></span></div></div>';
    view.oninput = view.onchange = function (e) {
      var t = e.target;
      if (t.dataset.f) { T[t.dataset.f] = t.value; paintTeacher(); return; }
      if (e.type === 'change' && t.dataset.entry) setScreening(t, s);
    };
    loadData(s).then(paintTeacher);
    every(function () { loadData(s).then(function () { if (!editingIn($('#tList'))) paintTeacher(); else updateBadges(); }); });
  }
  function entryToolbar(F) {
    return '<div class="toolbar"><input class="in search" data-f="q" value="' + esc(F.q) + '" placeholder="Search name or chest no." type="search">' +
      '<select class="in" data-f="program">' + progOpts(F.program, 'All programs') + '</select>' +
      '<select class="in" data-f="group">' + opts(AB.GROUPS, F.group, 'All groups') + '</select>' +
      '<select class="in" data-f="cls">' + opts(AB.CLASSES, F.cls, 'All classes') + '</select>' +
      '<select class="in" data-f="gender">' + opts(AB.GENDERS, F.gender, 'Boys & Girls') + '</select></div>';
  }
  function filterEntries(F) {
    var q = F.q.trim().toLowerCase();
    return (D.assignments || []).filter(function (a) {
      return (!F.program || a.program === F.program) && (!F.group || a.group === F.group) && (!F.cls || a.cls === F.cls) &&
        (!F.gender || a.gender === F.gender) && (!F.status || a.screening === F.status) &&
        (!q || String(a.chest).indexOf(q) === 0 || String(a.name || '').toLowerCase().indexOf(q) >= 0);
    }).sort(function (x, y) { return Number(x.chest) - Number(y.chest) || x.program.localeCompare(y.program); });
  }
  function paintTeacher() {
    if (!D || !$('#tList')) return;
    var all = filterEntries(Object.assign({}, T, { status: '' }));
    $('#tStats').innerHTML = AB.SCREENING.map(function (st, i) {
      var n = all.filter(function (a) { return a.screening === st; }).length;
      return '<button class="stat" style="border:0;text-align:left;cursor:pointer;' + (T.status === st ? 'outline:2px solid var(--green)' : '') + '" data-status="' + esc(st) + '"><b class="pill st-' + i + '" style="font-size:22px;background:none;padding:0">' + n + '</b><span>' + esc(st) + '</span></button>';
    }).join('');
    $$('#tStats [data-status]').forEach(function (b) { b.onclick = function () { T.status = T.status === b.dataset.status ? '' : b.dataset.status; paintTeacher(); }; });
    var list = filterEntries(T);
    $('#tCount').textContent = list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') + (T.status ? ' · ' + T.status : '');
    $('#tList').innerHTML = list.length ? list.slice(0, 400).map(function (a) {
      return '<div class="item"><span class="chest">' + esc(a.chest) + '</span><div class="who"><b>' + esc(a.name) + '</b><div class="meta"><span>' + esc(a.cls) + '</span><span>' + esc(shortGroup(a.group)) + '</span><span>' + esc(a.gender) + '</span><span>Entry ' + esc(a.entry) + '</span></div></div>' +
        '<div class="acts">' + ci(a.chest, a.checkin) + '<span class="pill cat-' + esc(a.category) + '">' + esc(a.program) + '</span>' +
        '<select class="pill-sel st-' + stIdx(a.screening) + '" data-entry="' + esc(a.entry) + '" aria-label="Screening status for chest ' + esc(a.chest) + '">' + opts(AB.SCREENING, a.screening) + '</select></div></div>';
    }).join('') + (list.length > 400 ? '<div class="empty">Showing first 400 — use the filters to narrow down.</div>' : '') : '<div class="empty">No entries match these filters.</div>';
  }
  function setScreening(sel, s) {
    var entry = sel.dataset.entry, status = sel.value;
    var a = D.assignments.filter(function (x) { return x.entry === entry; })[0], prev = a && a.screening;
    if (a) a.screening = status;
    sel.className = 'pill-sel st-' + stIdx(status);
    api('screen', { token: s.token, entry: entry, status: status }).then(function (r) {
      if (!r.ok) { if (a) a.screening = prev; toast(r.error, true); if (r.auth) { setSession(s.role, null); route(); } else (current() === 'admin' ? paintAdmin() : paintTeacher()); return; }
      toast('Chest ' + (a ? a.chest : '') + ' · ' + status);
      if (current() === 'teacher') { var st = $('#tStats'); if (st) paintTeacherStatsOnly(); }
    });
  }
  function paintTeacherStatsOnly() {
    var all = filterEntries(Object.assign({}, T, { status: '' }));
    $$('#tStats [data-status]').forEach(function (b) { $('b', b).textContent = all.filter(function (a) { return a.screening === b.dataset.status; }).length; });
  }
  function current() { return location.hash.replace('#', '') || 'register'; }

  // =====================================================================
  // 4. VOLUNTEER CHECK-IN
  // =====================================================================
  var V = { q: '', show: '' };
  function viewVolunteer() {
    var s = sessFor('volunteer');
    if (!s) return loginCard('volunteer', 'Volunteer Check-In', 'Mark arrivals at the desk. Your name and phone are logged.',
      fld('Volunteer name', 'name', 'autocomplete="name" required') + fld('Phone number', 'phone', 'type="tel" inputmode="tel" required'), 'Open check-in desk');
    view.innerHTML = head('Check-in desk', 'Volunteer Check-In', 'Search by chest number, name or phone. You can mark attendance and add notes — registration details stay locked.', s) +
      '<div class="stats" id="vStats"></div><div class="bigsearch" style="margin-bottom:12px"><input class="in" id="vq" type="search" inputmode="search" placeholder="Chest no., name or phone" value="' + esc(V.q) + '" autocomplete="off"></div>' +
      '<div class="row" style="margin-bottom:14px"><div class="seg" id="vShow">' + [['', 'All'], [AB.PRESENT, 'Present'], [AB.ABSENT, 'Not Present']].map(function (x) {
        return '<button data-show="' + x[0] + '" class="' + (V.show === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div><span class="count grow" id="vCount" style="margin:0;text-align:right"></span></div>' +
      '<div class="list" id="vList"><div class="loading"><span class="spin dark"></span></div></div>';
    $('#vq').focus();
    view.oninput = function (e) { if (e.target.id === 'vq') { V.q = e.target.value; paintVolunteer(); } };
    view.onkeydown = function (e) { if (e.key === 'Enter' && e.target.dataset.notefor) { e.preventDefault(); addNote(e.target.dataset.notefor, s); } };
    view.onclick = function (e) {
      var sh = e.target.closest('[data-show]'); if (sh) { V.show = sh.dataset.show; $$('#vShow button').forEach(function (b) { b.classList.toggle('on', b === sh); }); paintVolunteer(); return; }
      var tg = e.target.closest('[data-toggle]'); if (tg) { toggleCheckin(tg, s); return; }
      var an = e.target.closest('[data-addnote]'); if (an) addNote(an.dataset.addnote, s);
    };
    loadData(s).then(paintVolunteer);
    every(function () { loadData(s).then(function () { if (!editingIn($('#vList'))) paintVolunteer(); else updateBadges(); }); });
  }
  function paintVolunteer() {
    if (!D || !$('#vList')) return;
    var regs = D.registrations || [];
    var pres = regs.filter(function (r) { return r.checkin === AB.PRESENT; }).length;
    $('#vStats').innerHTML = '<div class="stat"><b>' + regs.length + '</b><span>Registered</span></div><div class="stat g"><b>' + pres + '</b><span>Present</span></div><div class="stat r"><b>' + (regs.length - pres) + '</b><span>Not present</span></div>';
    var q = V.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    var list = regs.filter(function (r) {
      if (V.show && r.checkin !== V.show) return false;
      if (!q) return true;
      return String(r.chest) === q || String(r.chest).indexOf(q) === 0 || String(r.name).toLowerCase().indexOf(q) >= 0 || (qd.length >= 3 && String(r.phone).indexOf(qd) >= 0);
    }).sort(function (a, b) {
      if (q && String(a.chest) === q) return -1; if (q && String(b.chest) === q) return 1;
      return Number(a.chest) - Number(b.chest);
    });
    $('#vCount').textContent = list.length + ' student' + (list.length === 1 ? '' : 's');
    $('#vList').innerHTML = list.length ? list.slice(0, 150).map(function (r) {
      var on = r.checkin === AB.PRESENT;
      var items = AB.splitItems(r.sports).concat(AB.splitItems(r.arts));
      return '<div class="vcard"><span class="chest lg">' + esc(r.chest) + '</span><div><div class="row" style="gap:8px"><b style="font-size:16px">' + esc(r.name) + '</b>' + ci(r.chest, r.checkin) + '</div>' +
        '<div class="meta small muted" style="margin-top:3px">' + esc(r.gender) + ' · ' + esc(r.cls) + ' · ' + esc(shortGroup(r.group)) + ' · ' + esc(r.phone) + '</div>' +
        '<div class="small" style="margin-top:6px">' + items.map(esc).join(' · ') + '</div>' +
        (on && r.checkinAt ? '<div class="small muted" style="margin-top:4px">Checked in ' + esc(String(r.checkinAt).slice(11, 16)) + ' by ' + esc(r.checkinBy) + '</div>' : '') + '</div>' +
        '<button class="btn tog ' + (on ? 'isin' : 'isout') + '" data-toggle="' + esc(r.chest) + '">' + (on ? '✓ Checked in' : 'Mark present') + '</button>' +
        (r.notes ? '<div class="notes">' + esc(r.notes) + '</div>' : '') +
        '<div class="addnote"><input class="in" data-notefor="' + esc(r.chest) + '" placeholder="Add note (team members, arrival info…)" maxlength="300"><button class="btn sm ghost" data-addnote="' + esc(r.chest) + '">Add note</button></div></div>';
    }).join('') + (list.length > 150 ? '<div class="empty">Showing first 150 — search to narrow down.</div>' : '') : '<div class="empty">No student found. Check the chest number or try the name / phone.</div>';
  }
  function toggleCheckin(btn, s) {
    var chest = btn.dataset.toggle;
    var r = D.registrations.filter(function (x) { return String(x.chest) === String(chest); })[0];
    var to = r.checkin === AB.PRESENT ? AB.ABSENT : AB.PRESENT;
    busy(btn, true, '');
    api('checkin', { token: s.token, chest: chest, status: to }).then(function (res) {
      if (!res.ok) { busy(btn, false); toast(res.error, true); if (res.auth) { setSession(s.role, null); route(); } return; }
      r.checkin = to; r.checkinBy = s.name; r.checkinAt = to === AB.PRESENT ? new Date().toISOString().replace('T', ' ') : '';
      D.assignments.forEach(function (a) { if (String(a.chest) === String(chest)) a.checkin = to; });
      toast('Chest ' + chest + ' · ' + (to === AB.PRESENT ? 'checked in' : 'marked not present'));
      if (current() === 'admin') paintAdmin(); else paintVolunteer();
    });
  }
  function addNote(chest, s) {
    var inp = $('[data-notefor="' + chest + '"]'); var text = inp && inp.value.trim();
    if (!text) { if (inp) inp.focus(); return; }
    inp.disabled = true;
    api('note', { token: s.token, chest: chest, note: text }).then(function (r) {
      inp.disabled = false;
      if (!r.ok) { toast(r.error, true); return; }
      inp.value = ''; inp.blur(); toast('Note added to chest ' + chest);
      loadData(s).then(paintVolunteer);
    });
  }

  // =====================================================================
  // 5. JUDGE SCORING
  // =====================================================================
  var J = { gender: 'Boys', group: '', selectedOnly: false, program: '', dirty: false };
  function viewJudge() {
    var s = sessFor('judge');
    if (!s) return loginCard('judge', 'Judge Scoring', 'Choose the program you are judging. Participants are shown by chest number only.',
      fld('Judge name', 'name', 'autocomplete="name" required') +
      '<div class="field"><label class="f" for="f_program">Program / event</label><select class="in" id="f_program" name="program">' + progOpts('', 'Select program') + '</select></div>' +
      fld('Judge code <span class="muted" style="font-weight:400">(only if you were given one)</span>', 'code', 'type="password" autocomplete="off"'), 'Start judging');
    var isAdmin = s.role === 'admin';
    var program = isAdmin ? (J.program || AB.ARTS_BOYS[0]) : s.program;
    J.program = program;
    var cat = AB.categoryOf(program), allowed = AB.gendersFor(program);
    if (allowed.indexOf(J.gender) < 0) J.gender = allowed[0] || 'Boys';
    view.innerHTML = head('Judge scoring', 'Judging: ' + esc(program) + ' ' + catPill(cat), 'Score each chest number out of 100. You can change your marks until results are final.', s) +
      '<div class="toolbar" style="grid-template-columns:' + (isAdmin ? '1.4fr ' : '') + 'auto 1fr auto">' +
      (isAdmin ? '<select class="in" id="jProg">' + progOpts(program) + '</select>' : '') +
      '<div class="seg" id="jGender">' + AB.GENDERS.map(function (g) { var dis = allowed.indexOf(g) < 0; return '<button data-g="' + g + '" class="' + (J.gender === g ? 'on' : '') + '"' + (dis ? ' disabled title="' + esc(allowed[0] || '') + ' only" style="opacity:.4"' : '') + '>' + g + '</button>'; }).join('') + '</div>' +
      '<select class="in" id="jGroup">' + opts(AB.GROUPS, J.group, 'All age groups') + '</select>' +
      '<label class="pick' + (J.selectedOnly ? ' on' : '') + '" style="min-height:46px"><input type="checkbox" id="jSel"' + (J.selectedOnly ? ' checked' : '') + '>Selected for program only</label></div>' +
      '<div class="list" id="jList"><div class="loading"><span class="spin dark"></span></div></div>' +
      '<div class="savebar"><span class="grow" id="jSum"></span><button class="btn gold" id="jSave">Submit scores</button></div>';
    view.onclick = function (e) {
      var g = e.target.closest('[data-g]'); if (g && !g.disabled) { J.gender = g.dataset.g; $$('#jGender button').forEach(function (b) { b.classList.toggle('on', b === g); }); paintJudge(); return; }
      if (e.target.closest('#jSave')) saveScores(s);
    };
    view.onchange = function (e) {
      if (e.target.id === 'jGroup') { J.group = e.target.value; paintJudge(); }
      if (e.target.id === 'jSel') { J.selectedOnly = e.target.checked; e.target.parentNode.classList.toggle('on', J.selectedOnly); paintJudge(); }
      if (e.target.id === 'jProg') { if (J.dirty && !confirm('Discard unsaved scores?')) { e.target.value = J.program; return; } J.program = e.target.value; J.dirty = false; viewJudge(); }
    };
    view.oninput = function (e) { if (e.target.dataset.score != null || e.target.dataset.remarks != null) { J.dirty = true; paintJudgeSum(); } };
    loadData(s).then(paintJudge);
    every(function () { loadData(s).then(function () { if (J.dirty || editingIn($('#jList'))) updateBadges(); else paintJudge(); }); });
  }
  function judgeEntries() {
    return (D.assignments || []).filter(function (a) {
      return a.program === J.program && a.gender === J.gender && (!J.group || a.group === J.group) && (!J.selectedOnly || a.screening === 'Selected for Program');
    }).sort(function (x, y) { return AB.GROUPS.indexOf(x.group) - AB.GROUPS.indexOf(y.group) || Number(x.chest) - Number(y.chest); });
  }
  function myScore(chest) {
    var me = sessFor('judge').name;
    return (D.scores || []).filter(function (x) { return x.program === J.program && String(x.chest) === String(chest) && x.judge === me; })[0];
  }
  function paintJudge() {
    if (!D || !$('#jList')) return;
    var list = judgeEntries(), lastGroup = null;
    $('#jList').innerHTML = list.length ? list.map(function (a) {
      var m = myScore(a.chest), sep = '';
      if (!J.group && a.group !== lastGroup) { lastGroup = a.group; sep = '<h3 style="margin:10px 0 0">' + esc(a.group) + '</h3>'; }
      return sep + '<div class="jrow' + (m ? ' saved' : '') + '"><span class="chest lg">' + esc(a.chest) + '</span>' +
        '<div><div class="row" style="gap:6px">' + ci(a.chest, a.checkin) + stPill(a.screening) + '</div><div class="small muted" style="margin-top:4px">' + esc(a.cls) + ' · ' + esc(shortGroup(a.group)) + (m ? ' · <span style="color:var(--ok)">saved ' + esc(m.score) + '</span>' : '') + '</div></div>' +
        '<input class="in score" data-score="' + esc(a.chest) + '" type="number" inputmode="decimal" min="0" max="100" step="0.5" placeholder="/100" value="' + (m ? esc(m.score) : '') + '" aria-label="Score for chest ' + esc(a.chest) + '">' +
        '<input class="in rm" data-remarks="' + esc(a.chest) + '" placeholder="Remarks (optional)" value="' + (m ? esc(m.remarks) : '') + '" maxlength="200"></div>';
    }).join('') : '<div class="empty">No participants for ' + esc(J.program) + ' · ' + esc(J.gender) + (J.group ? ' · ' + esc(J.group) : '') + (J.selectedOnly ? ' (selected only)' : '') + '.</div>';
    paintJudgeSum();
  }
  function paintJudgeSum() {
    var inputs = $$('[data-score]'), filled = inputs.filter(function (i) { return i.value !== ''; }).length;
    var el = $('#jSum'); if (el) el.innerHTML = '<b>' + inputs.length + '</b> participants · <b>' + filled + '</b> scored' + (J.dirty ? ' · <span style="color:var(--gold)">unsaved changes</span>' : '');
  }
  function saveScores(s) {
    var entries = [], bad = null;
    $$('[data-score]').forEach(function (inp) {
      if (inp.value === '') return;
      var v = Number(inp.value);
      if (isNaN(v) || v < 0 || v > 100) { bad = bad || inp; inp.classList.add('err'); return; }
      inp.classList.remove('err');
      var rm = $('[data-remarks="' + inp.dataset.score + '"]');
      entries.push({ chest: inp.dataset.score, score: v, remarks: rm ? rm.value : '' });
    });
    if (bad) { toast('Scores must be between 0 and 100.', true); bad.focus(); return; }
    if (!entries.length) { toast('Enter at least one score first.', true); return; }
    var btn = $('#jSave'); busy(btn, true);
    api('score', { token: s.token, program: J.program, entries: entries }).then(function (r) {
      busy(btn, false);
      if (!r.ok) { toast(r.error, true); if (r.auth) { setSession(s.role, null); route(); } return; }
      J.dirty = false; toast(r.saved + ' score' + (r.saved === 1 ? '' : 's') + ' saved — scoreboard updated');
      loadData(s).then(paintJudge);
    });
  }

  // =====================================================================
  // 6. ADMIN
  // =====================================================================
  var A = { tab: 'overview', q: '', F: { q: '', group: '', cls: '', gender: '', program: '', status: '' }, resProg: '' };
  var TABS = [['overview', 'Overview'], ['regs', 'Registrations'], ['entries', 'Program Entries'], ['scores', 'Scores'], ['results', 'Results'], ['logs', 'Staff Logs']];
  function viewAdmin() {
    var s = sessions.admin;
    if (!s) return loginCard('admin', 'Admin Panel', 'Full access to registrations, screening, check-in, scores and exports.',
      fld('Username', 'user', 'autocomplete="username" autocapitalize="off" required') + fld('Password', 'pass', 'type="password" autocomplete="current-password" required'), 'Log in');
    view.innerHTML = head('Control room', 'Admin Panel', 'Everything in one place. Edits sync to the Google Sheet.', s) +
      '<div class="row noprint" style="margin-bottom:14px" id="aActions"></div>' +
      '<div class="subtabs" id="aTabs">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (A.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div id="aBody"><div class="loading"><span class="spin dark"></span></div></div>';
    view.onclick = function (e) { adminClick(e, s); };
    view.oninput = view.onchange = function (e) {
      var t = e.target;
      if (t.dataset.f) { A.F[t.dataset.f] = t.value; paintAdminList(); return; }
      if (t.dataset.aq != null) { A.q = t.value; paintAdminList(); return; }
      if (t.id === 'resProg') { A.resProg = t.value; paintAdminList(); return; }
      if (e.type === 'change' && t.dataset.entry) setScreening(t, s);
    };
    loadData(s).then(paintAdmin);
    every(function () { loadData(s).then(function () { if (!editingIn($('#aBody'))) paintAdminList(); else updateBadges(); }); });
  }
  function paintAdmin() {
    if (!D || !$('#aBody')) return;
    $('#aActions').innerHTML = (D.sheetUrl ? '<a class="btn ghost sm" href="' + esc(D.sheetUrl) + '" target="_blank" rel="noopener">Open Google Sheet ↗</a>' : '') +
      '<button class="btn ghost sm" data-export="1">Export this tab (CSV)</button><button class="btn ghost sm" data-refresh="1">Refresh</button>' +
      (DEMO ? '<span class="grow"></span><button class="btn sm gold" data-seed="1">Load sample data</button><button class="btn sm danger" data-reset="1">Reset demo</button>' : '');
    $$('#aTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === A.tab); });
    var b = $('#aBody');
    if (A.tab === 'overview') b.innerHTML = '<div id="aList"></div>';
    else if (A.tab === 'entries') b.innerHTML = entryToolbar(A.F) + '<p class="count" id="aCount"></p><div id="aList"></div>';
    else if (A.tab === 'results') b.innerHTML = '<div class="toolbar t3"><select class="in" id="resProg">' + progOpts(A.resProg, 'All programs') + '</select></div><div id="aList"></div>';
    else b.innerHTML = '<div class="toolbar t3"><input class="in search" type="search" data-aq="1" placeholder="Search…" value="' + esc(A.q) + '"></div><p class="count" id="aCount"></p><div id="aList"></div>';
    paintAdminList();
  }
  function table(cols, rows) {
    return '<div class="tablewrap"><table><thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="' + cols.length + '" class="muted" style="text-align:center;padding:30px">Nothing here yet.</td></tr>') + '</tbody></table></div>';
  }
  function match(obj, q) { q = q.trim().toLowerCase(); if (!q) return true; return Object.keys(obj).some(function (k) { return String(obj[k]).toLowerCase().indexOf(q) >= 0; }); }
  function setCount(n, w) { var c = $('#aCount'); if (c) c.textContent = n + ' ' + w; }
  function paintAdminList() {
    var el = $('#aList'); if (!el || !D) return;
    var regs = D.registrations || [], as = D.assignments || [], sc = D.scores || [];
    if (A.tab === 'overview') {
      var pres = regs.filter(function (r) { return r.checkin === AB.PRESENT; }).length;
      var res = AB.computeResults(as, sc);
      el.innerHTML = '<div class="stats">' +
        [[regs.length, 'Students'], [regs.filter(function (r) { return r.gender === 'Boys'; }).length, 'Boys'], [regs.filter(function (r) { return r.gender === 'Girls'; }).length, 'Girls'],
          [pres, 'Checked in', 'g'], [regs.length - pres, 'Not present', 'r'], [as.length, 'Program entries'],
          [as.filter(function (a) { return a.screening === 'Selected for Program'; }).length, 'Selected'], [sc.length, 'Marks submitted', 'y'], [res.length, 'Results live']]
          .map(function (x) { return '<div class="stat ' + (x[2] || '') + '"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('') + '</div>' +
        '<h3 style="margin:6px 0 10px">Entries by program</h3>' +
        table(['Program', 'Category', 'Boys', 'Girls', 'Present', 'Selected', 'Scored', 'Judges'], AB.allPrograms().map(function (p) {
          var e = as.filter(function (a) { return a.program === p; }); if (!e.length) return null;
          var ps = sc.filter(function (x) { return x.program === p; });
          var judges = {}; ps.forEach(function (x) { judges[x.judge] = 1; });
          var scored = {}; ps.forEach(function (x) { scored[x.chest] = 1; });
          return '<tr><td><b>' + esc(p) + '</b></td><td>' + catPill(AB.categoryOf(p)) + '</td><td class="num">' + e.filter(function (a) { return a.gender === 'Boys'; }).length + '</td><td class="num">' + e.filter(function (a) { return a.gender === 'Girls'; }).length +
            '</td><td class="num">' + e.filter(function (a) { return a.checkin === AB.PRESENT; }).length + '</td><td class="num">' + e.filter(function (a) { return a.screening === 'Selected for Program'; }).length +
            '</td><td class="num">' + Object.keys(scored).length + ' / ' + e.length + '</td><td>' + esc(Object.keys(judges).join(', ')) + '</td></tr>';
        }).filter(Boolean));
    } else if (A.tab === 'regs') {
      var list = regs.filter(function (r) { return match(r, A.q); }).sort(function (a, b) { return Number(a.chest) - Number(b.chest); });
      setCount(list.length, 'students');
      el.innerHTML = table(['Chest', 'Name', 'Gender', 'Class', 'Group', 'Phone', 'Sports', 'Arts', 'Check-in', 'Notes', ''], list.map(function (r) {
        return '<tr><td><span class="chest">' + esc(r.chest) + '</span></td><td><b>' + esc(r.name) + '</b><div class="small muted">' + esc(r.ts) + '</div></td><td>' + esc(r.gender) + '</td><td>' + esc(r.cls) + '</td><td>' + esc(shortGroup(r.group)) + '</td><td>' + esc(r.phone) + '</td>' +
          '<td class="small">' + esc(r.sports) + '</td><td class="small">' + esc(r.arts) + '</td><td><button class="btn sm ghost" data-toggle="' + esc(r.chest) + '" style="padding:2px 4px;box-shadow:none">' + ci(r.chest, r.checkin) + '</button></td>' +
          '<td class="small" style="white-space:pre-line;max-width:220px">' + esc(r.notes) + '</td>' +
          '<td style="white-space:nowrap"><button class="btn sm ghost" data-edit="' + esc(r.chest) + '">Edit</button> <button class="btn sm danger" data-del="' + esc(r.chest) + '">Delete</button></td></tr>';
      }));
    } else if (A.tab === 'entries') {
      var en = filterEntries(A.F);
      setCount(en.length, 'entries');
      el.innerHTML = table(['Entry', 'Chest', 'Name', 'Gender', 'Class', 'Group', 'Program', 'Check-in', 'Screening', 'By'], en.map(function (a) {
        return '<tr><td>' + esc(a.entry) + '</td><td><span class="chest">' + esc(a.chest) + '</span></td><td><b>' + esc(a.name) + '</b></td><td>' + esc(a.gender) + '</td><td>' + esc(a.cls) + '</td><td>' + esc(shortGroup(a.group)) + '</td>' +
          '<td><span class="pill cat-' + esc(a.category) + '">' + esc(a.program) + '</span></td><td>' + ci(a.chest, a.checkin) + '</td>' +
          '<td><select class="pill-sel st-' + stIdx(a.screening) + '" data-entry="' + esc(a.entry) + '">' + opts(AB.SCREENING, a.screening) + '</select></td><td class="small muted">' + esc(a.screenedBy) + '</td></tr>';
      }));
    } else if (A.tab === 'scores') {
      var sl = sc.filter(function (x) { return match(x, A.q); }).sort(function (a, b) { return a.program.localeCompare(b.program) || Number(a.chest) - Number(b.chest); });
      setCount(sl.length, 'marks');
      el.innerHTML = table(['Program', 'Group', 'Chest', 'Name', 'Judge', 'Score', 'Remarks', 'Time', ''], sl.map(function (x, i) {
        return '<tr><td>' + esc(x.program) + '</td><td>' + esc(shortGroup(x.group)) + '</td><td><span class="chest">' + esc(x.chest) + '</span> ' + ci(x.chest, checkinOf(x.chest)) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.judge) + '</td><td class="num"><b>' + esc(x.score) + '</b></td><td class="small">' + esc(x.remarks) + '</td><td class="small muted">' + esc(x.ts) + '</td>' +
          '<td><button class="btn sm danger" data-delscore="' + i + '">Delete</button></td></tr>';
      }));
      A._scoreList = sl;
    } else if (A.tab === 'results') {
      var rs = AB.computeResults(as, sc).filter(function (b) { return !A.resProg || b.program === A.resProg; });
      A._results = rs;
      el.innerHTML = rs.length ? rs.map(function (b) {
        return '<h3 style="margin:18px 0 8px">' + esc(b.program) + ' · ' + esc(b.gender) + ' · ' + esc(b.group) + '</h3>' +
          table(['Rank', 'Chest', 'Name', 'Class', 'Average', 'Total', 'Judges'], b.entries.map(function (e) {
            return '<tr><td>' + (e.rank <= 3 ? '<span class="medal m' + e.rank + '" style="width:26px;height:26px;font-size:12px">' + e.rank + '</span>' : e.rank) + '</td><td><span class="chest">' + esc(e.chest) + '</span></td><td><b>' + esc(e.name) + '</b></td><td>' + esc(e.cls) + '</td><td class="num"><b>' + e.avg + '</b></td><td class="num">' + e.total + '</td><td class="num">' + e.judges + '</td></tr>';
          }));
      }).join('') : '<div class="empty">No marks submitted yet.</div>';
    } else if (A.tab === 'logs') {
      var lg = (D.staffLogs || []).filter(function (x) { return match(x, A.q); }).slice().reverse();
      setCount(lg.length, 'logins');
      el.innerHTML = table(['Role', 'Name', 'Phone', 'Login time', 'Detail'], lg.map(function (x) {
        return '<tr><td><span class="pill">' + esc(x.role) + '</span></td><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.phone) + '</td><td>' + esc(x.ts) + '</td><td class="small">' + esc(x.detail) + '</td></tr>';
      }));
    }
  }
  function adminClick(e, s) {
    var t;
    if ((t = e.target.closest('[data-tab]'))) { A.tab = t.dataset.tab; A.q = ''; paintAdmin(); return; }
    if (e.target.closest('[data-refresh]')) { loadData(s).then(paintAdmin); return; }
    if (e.target.closest('[data-export]')) { exportTab(); return; }
    if (e.target.closest('[data-seed]')) { window.ABDemo.seed(); toast('Sample data loaded'); loadData(s).then(paintAdmin); return; }
    if (e.target.closest('[data-reset]')) {
      if (!confirm('Delete ALL demo data in this browser?')) return;
      window.ABDemo.reset(); sessions = {}; store.set('sessions', {}); D = null; toast('Demo data cleared'); route(); return;
    }
    if ((t = e.target.closest('[data-toggle]'))) { toggleCheckin(t, s); return; }
    if ((t = e.target.closest('[data-edit]'))) { editReg(t.dataset.edit, s); return; }
    if ((t = e.target.closest('[data-del]'))) {
      var r = D.registrations.filter(function (x) { return String(x.chest) === t.dataset.del; })[0];
      if (!confirm('Delete chest ' + r.chest + ' — ' + r.name + '?\nThis removes the registration, all program entries and all marks. It cannot be undone.')) return;
      api('deleteReg', { token: s.token, chest: r.chest }).then(function (x) { if (!x.ok) return toast(x.error, true); toast('Deleted chest ' + r.chest); loadData(s).then(paintAdmin); });
      return;
    }
    if ((t = e.target.closest('[data-delscore]'))) {
      var m = A._scoreList[Number(t.dataset.delscore)];
      if (!confirm('Delete ' + m.judge + '\'s mark (' + m.score + ') for chest ' + m.chest + ' in ' + m.program + '?')) return;
      api('deleteScore', { token: s.token, program: m.program, chest: m.chest, judge: m.judge }).then(function (x) { if (!x.ok) return toast(x.error, true); toast('Mark deleted'); loadData(s).then(paintAdmin); });
    }
  }
  function editReg(chest, s) {
    var r = D.registrations.filter(function (x) { return String(x.chest) === String(chest); })[0];
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="card" id="editForm"><div class="row" style="margin-bottom:14px"><span class="chest">' + esc(r.chest) + '</span><h3 class="grow">Edit registration</h3><button type="button" class="btn sm ghost" data-close>Close</button></div>' +
      '<div class="field"><label class="f">Full name</label><input class="in" name="name" value="' + esc(r.name) + '"></div>' +
      '<div class="field"><label class="f">Parent phone</label><input class="in" name="phone" type="tel" value="' + esc(r.phone) + '"></div>' +
      '<div class="grid2"><div class="field"><label class="f">Class</label><select class="in" name="cls">' + opts(AB.CLASSES, r.cls) + '</select></div>' +
      '<div class="field"><label class="f">Group</label><select class="in" name="group">' + opts(AB.GROUPS, r.group) + '</select></div></div>' +
      '<div class="field"><label class="f">Volunteer notes</label><textarea class="in" name="notes" rows="3">' + esc(r.notes) + '</textarea></div>' +
      '<p class="hint">Gender and items can\'t be changed here — delete and re-register if needed.</p><div id="editErr"></div>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save changes</button></div></form>';
    document.body.appendChild(m);
    m.onclick = function (e) { if (e.target === m || e.target.closest('[data-close]')) m.remove(); };
    $('#editForm').onsubmit = function (e) {
      e.preventDefault();
      var patch = {}; $$('[name]', m).forEach(function (el) { patch[el.name] = el.value; });
      var btn = $('button[type=submit]', m); busy(btn, true);
      api('updateReg', { token: s.token, chest: r.chest, patch: patch }).then(function (x) {
        busy(btn, false);
        if (!x.ok) { $('#editErr').innerHTML = '<div class="notice bad" style="margin-bottom:12px">' + esc(x.error) + '</div>'; return; }
        m.remove(); toast('Saved chest ' + r.chest); loadData(s).then(paintAdmin);
      });
    };
  }
  function toCSV(cols, rows) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols.map(function (c) { return q(c[1]); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(','); })).join('\r\n');
  }
  function exportTab() {
    var map = { overview: 'Registrations', regs: 'Registrations', entries: 'Program_Assignments', scores: 'Scores', results: 'Live_Leaderboard', logs: 'Staff_Logs' };
    var tab = map[A.tab], rows;
    if (tab === 'Registrations') rows = D.registrations;
    else if (tab === 'Program_Assignments') rows = D.assignments;
    else if (tab === 'Scores') rows = D.scores;
    else if (tab === 'Staff_Logs') rows = D.staffLogs;
    else {
      rows = [];
      AB.computeResults(D.assignments, D.scores).forEach(function (b) { b.entries.forEach(function (e) { rows.push(Object.assign({ program: b.program, category: b.category, gender: b.gender, updated: '' }, e)); }); });
    }
    var blob = new Blob(['﻿' + toCSV(AB.SCHEMA[tab], rows || [])], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'al-bahja-' + tab.toLowerCase() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('Exported ' + tab + ' (' + (rows || []).length + ' rows)');
  }

  var VIEWS = { register: viewRegister, scoreboard: viewScoreboard, teacher: viewTeacher, volunteer: viewVolunteer, judge: viewJudge, admin: viewAdmin };
  route();
})();
