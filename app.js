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
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.style.pointerEvents = 'none'; btn.innerHTML = '<span class="spin"></span>' + (label || 'Saving…'); }
    else { btn.disabled = false; btn.style.pointerEvents = ''; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
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
  function ciLook(st) { return st === AB.PRESENT ? ['in', 'Present'] : st === AB.CHECKED_OUT ? ['done', 'Checked out'] : ['out', 'Not Present']; }
  function ci(chest, st) {
    var l = ciLook(st);
    return '<span class="ci ' + l[0] + '" data-ci="' + esc(chest) + '">' + l[1] + '</span>';
  }
  /** Arts / Sports page switch. */
  function catSeg(cur, id) {
    return '<div class="seg big" id="' + id + '" style="max-width:360px;margin-bottom:14px">' + ['Arts', 'Sports'].map(function (c) {
      return '<button type="button" data-catpick="' + c + '" class="' + (cur === c ? 'on' : '') + '">' + (c === 'Arts' ? '🎤 Arts' : '⚽ Sports') + '</button>';
    }).join('') + '</div>';
  }
  function pickCat(e, id) {
    var b = e.target.closest('#' + id + ' [data-catpick]'); if (!b) return null;
    $$('#' + id + ' button').forEach(function (x) { x.classList.toggle('on', x === b); });
    return b.dataset.catpick;
  }
  /** "Show: All | Boys | Girls | Rawdha" buttons — only changes what you see. */
  function secSeg(cur, id) {
    return '<div class="row" style="margin-bottom:12px;gap:8px"><span class="small muted" style="font-weight:600">Show</span><div class="seg" id="' + id + '">' +
      [['', 'All']].concat(AB.SECTIONS.map(function (s) { return [s, s]; })).map(function (x) {
        return '<button type="button" data-sec="' + x[0] + '" class="' + ((cur || '') === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div></div>';
  }
  function pickSec(e, id) {
    var b = e.target.closest('#' + id + ' [data-sec]'); if (!b) return null;
    $$('#' + id + ' button').forEach(function (x) { x.classList.toggle('on', x === b); });
    return b.dataset.sec;
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
      var l = ciLook(checkinOf(el.dataset.ci));
      el.className = 'ci ' + l[0]; el.textContent = l[1];
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
    var v = location.hash.replace('#', '') || 'home';
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
  // 0. START SCREEN
  // =====================================================================
  function viewHome() {
    var tile = function (href, cls, icon, iconBg, title, sub) {
      return '<a class="tile ' + cls + '" href="' + href + '"><span class="ic" style="' + iconBg + '">' + icon + '</span><div><b>' + title + '</b><span>' + sub + '</span></div></a>';
    };
    view.innerHTML = '<section class="home"><div style="text-align:center"><img src="assets/logo.png" alt="Al Bahja" style="width:84px;height:100px;object-fit:contain;margin:0 auto 6px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.15));background:var(--green);border-radius:20px;padding:8px">' +
      '<h2 style="font-size:26px;margin-top:10px">Al Bahja Madrasa Meet \'26</h2><p class="muted" style="margin:6px 0 0">Fri, 4 Dec 2026 · Saihat Istiraha, Dhahran–Jubail Highway</p></div>' +
      '<div class="tiles">' +
      tile('#register', 'main', '✍️', '', 'Student Registration', 'Register a child for arts and sports items') +
      tile('#scoreboard', '', '🏆', 'background:var(--gold-l)', 'Live Scoreboard', 'Results and program status') +
      tile('#teacher', '', '📋', 'background:#E7EEFB', 'Teacher Login', 'Screening, programs and students') +
      '</div></section>';
  }

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
      if (t.name === 'cls' || t.name === 'group') { R[t.name] = t.value; fitItems(); }
      if (t.dataset.item) {
        var arr = R[t.dataset.cat];
        if (t.checked && arr.length < AB.MAX_PER_CATEGORY && arr.indexOf(t.dataset.item) < 0) arr.push(t.dataset.item);
        if (!t.checked) R[t.dataset.cat] = arr.filter(function (x) { return x !== t.dataset.item; });
        delete R.err.items;
        paintStep();
      }
    };
  }

  /** Drop picks that no longer fit after changing gender or class (e.g. Rawdha has no sports). */
  function fitItems() {
    if (R.gender !== 'Boys' || AB.isRawdha(R.cls)) R.sports = [];
    var list = AB.artsFor(R.gender, R.cls);
    R.arts = R.arts.filter(function (x) { return list.indexOf(x) >= 0; });
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
      var html = '', rawdha = AB.isRawdha(R.cls);
      if (rawdha) html += '<div class="notice info" style="margin-top:0">Rawdha children choose from the Arts items below (no sports).</div>';
      else if (R.gender === 'Boys') html += pickSection('sports', 'Sports items', AB.SPORTS);
      else html += '<div class="notice info" style="margin-top:0">Sports items are for boys only — girls can choose from the Arts items below.</div>';
      html += pickSection('arts', 'Arts items', AB.artsFor(R.gender, R.cls));
      if (R.err.items) html += '<div class="notice bad">' + esc(R.err.items) + '</div>';
      html += '<div class="formnav"><button class="btn ghost" data-next="1">← Back</button><button class="btn" data-next="3">Next: review →</button></div>';
      b.innerHTML = html;
    } else if (R.step === 3) {
      b.innerHTML = '<div class="review"><h3 style="margin-bottom:14px">Check the details before submitting</h3><dl>' +
        '<dt>Full name</dt><dd>' + esc(R.name) + '</dd><dt>Gender</dt><dd>' + esc(R.gender) + '</dd>' +
        '<dt>Parent\'s phone</dt><dd>' + esc(R.phone) + '</dd><dt>Class</dt><dd>' + esc(R.cls) + '</dd><dt>Age group</dt><dd>' + esc(R.group) + '</dd>' +
        (R.gender === 'Boys' && !AB.isRawdha(R.cls) ? '<dt>Sports items</dt><dd>' + (esc(R.sports.join(', ')) || '<span class="muted">None</span>') + '</dd>' : '') +
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
      fitItems();
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
      var btn = $('#submitReg');
      submitRegistration(btn, false);
    }
  }
  function submitRegistration(btn, confirmDifferent) {
      busy(btn, true, 'Submitting…');
      api('register', { name: R.name, gender: R.gender, phone: R.phone, cls: R.cls, group: R.group, sports: R.sports, arts: R.arts, confirmDifferent: !!confirmDifferent }).then(function (r) {
        busy(btn, false);
        if (r.needConfirm) { askDifferentChild(r.existing, btn); return; }
        if (!r.ok) { $('#submitErr').innerHTML = '<div class="notice bad">' + esc(r.error) + '</div>'; return; }
        R.receipt = r.receipt; R.emailed = r.emailed; R.step = 4; viewRegister(); window.scrollTo(0, 0);
      });
  }
  /** Possible duplicate: tell the person registering and let them decide. */
  function askDifferentChild(ex, btn) {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="card" style="max-width:440px"><div style="font-size:34px;line-height:1;margin-bottom:6px">⚠️</div>' +
      '<h3 style="margin-bottom:8px">This child may already be registered</h3>' +
      '<p class="small" style="margin:0 0 10px">A very similar registration already exists:</p>' +
      '<div class="item" style="box-shadow:none;background:var(--gold-l);margin-bottom:12px"><span class="chest">' + esc(ex.chest) + '</span><div class="who"><b>' + esc(ex.name) + '</b>' +
      '<div class="meta"><span>' + esc(ex.gender) + '</span><span>' + esc(ex.cls) + '</span><span>' + esc(shortGroup(ex.group)) + '</span></div></div></div>' +
      '<p class="small muted" style="margin:0 0 14px">You are registering <b>' + esc(R.name) + '</b>. If this is the <b>same child</b>, do not register again — ask a teacher to edit Chest ' + esc(ex.chest) + '.</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><button class="btn ghost" data-same>Same child — don\'t register</button>' +
      '<button class="btn gold" data-diff>It\'s a different child — register anyway</button></div></div>';
    document.body.appendChild(m);
    m.onclick = function (e) {
      if (e.target.closest('[data-same]') || e.target === m) {
        m.remove();
        $('#submitErr').innerHTML = '<div class="notice warn">Not registered. ' + esc(ex.name) + ' is already Chest ' + esc(ex.chest) + '. To change details or items, please ask a teacher.</div>';
        return;
      }
      if (e.target.closest('[data-diff]')) { m.remove(); submitRegistration(btn, true); }
    };
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
            '.pass-frame .pass .entries div{display:block!important;line-height:22px;padding:6px 12px 14px!important;overflow:hidden}' +
            '.pass-frame .pass .entries code{display:inline-block;width:80px}.pass-frame .pass .entries div{position:relative}' +
            '.pass-frame .pass .entries .pill{position:absolute;right:12px;top:9px;line-height:16px;padding:1px 10px 7px}';
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
  var SB = { cat: 'Arts', gender: '', group: '', program: '', results: null, programs: null, at: '', view: 'results' };
  function viewScoreboard() {
    view.innerHTML = '<div class="page-head"><div><div class="eyebrow">Public results</div><h2>Live Scoreboard</h2><p class="muted small">Top 3 in every program, updating as judges submit marks.</p></div>' +
      '<div class="live"><i></i><span id="sbAt">Live</span></div></div>' +
      '<div class="subtabs" id="sbView"><button data-view="results" class="' + (SB.view === 'results' ? 'on' : '') + '">Results</button>' +
      '<button data-view="programs" class="' + (SB.view === 'programs' ? 'on' : '') + '">Program status</button></div>' +
      catSeg(SB.cat, 'sbCat') + secSeg(SB.gender, 'sbSec') +
      '<div class="toolbar t3">' +
      '<select class="in" data-f="group">' + opts(AB.GROUPS, SB.group, 'All age groups') + '</select>' +
      '<select class="in" data-f="program">' + progOpts(SB.program, 'All programs') + '</select></div>' +
      '<div id="sbBody"><div class="loading"><span class="spin dark"></span></div></div>';
    view.onchange = function (e) { var f = e.target.dataset.f; if (f) { SB[f] = e.target.value; paintScoreboard(); } };
    view.onclick = function (e) {
      var v = e.target.closest('#sbView [data-view]');
      if (v) { SB.view = v.dataset.view; $$('#sbView button').forEach(function (b) { b.classList.toggle('on', b === v); }); paintScoreboard(); return; }
      var c = pickCat(e, 'sbCat'); if (c) { SB.cat = c; SB.program = ''; viewScoreboard(); return; }
      var s = pickSec(e, 'sbSec'); if (s != null) { SB.gender = s; paintScoreboard(); }
    };
    fetchScoreboard(); every(fetchScoreboard);
  }
  /** Pending / Completed program lists. withButtons = staff view with Mark completed / Reopen. */
  function programStatusHtml(list, F, withButtons) {
    var rows = list.filter(function (p) {
      return (!F.cat || p.category === F.cat) && (!F.gender || p.section === F.gender) &&
        (!F.group || p.group === F.group || p.section === 'Rawdha') && (!F.program || p.program === F.program);
    });
    if (!rows.length) return '<div class="empty">No programs with registrations for this selection yet.</div>';
    function col(title, items, done) {
      return '<section class="card" style="padding:16px"><div class="row" style="margin-bottom:10px"><h3 class="grow">' + title + '</h3>' +
        '<span class="pill ' + (done ? 'st-3' : 'st-1') + '">' + items.length + '</span></div>' +
        (items.length ? items.map(function (p) {
          return '<div class="place" style="border-top:1px solid var(--line);border-radius:0;padding:10px 4px">' +
            '<div class="nm"><b>' + esc(p.program) + '</b><span>' + esc(p.section) + (p.section === 'Rawdha' ? '' : ' · ' + esc(shortGroup(p.group))) +
            ' · ' + p.entries + ' entr' + (p.entries === 1 ? 'y' : 'ies') + (p.scored == null ? '' : ' · ' + p.scored + ' scored') + '</span></div>' +
            (withButtons ? doneBtn(p.program, p.section, p.group).replace('<span class="pill st-3"', '<span hidden class="pill st-3"')
              : (done ? '<span class="pill st-3">✓ Completed</span>' : '<span class="pill st-1">Pending</span>')) + '</div>';
        }).join('') : '<p class="muted small" style="margin:0">' + (done ? 'Nothing completed yet.' : 'All done!') + '</p>') + '</section>';
    }
    var pending = rows.filter(function (p) { return p.status !== 'Completed'; }), done = rows.filter(function (p) { return p.status === 'Completed'; });
    return '<div class="grid2" style="align-items:start">' + col('Pending', pending, false) + col('✓ Completed', done, true) + '</div>';
  }
  function fetchScoreboard() {
    return api('scoreboard').then(function (r) {
      if (!r.ok) { toast(r.error, true); return; }
      SB.results = r.results; SB.programs = r.programs || []; SB.at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      paintScoreboard();
    });
  }
  function paintScoreboard() {
    var b = $('#sbBody'); if (!b || !SB.results) return;
    $('#sbAt').textContent = 'Live · updated ' + SB.at;
    if (SB.view === 'programs') { b.innerHTML = programStatusHtml(SB.programs || [], SB, false); return; }
    var res = SB.results.filter(function (x) {
      return (!SB.cat || x.category === SB.cat) && (!SB.gender || x.gender === SB.gender) &&
        (!SB.group || x.group === SB.group || (x.gender === 'Rawdha' && SB.gender === 'Rawdha')) && (!SB.program || x.program === SB.program);
    });
    if (!res.length) { b.innerHTML = '<div class="empty">No results yet for this selection. Results appear here as soon as judges submit marks.</div>'; return; }
    var cb = AB.classBoard(res), stars = AB.starBoard(res).slice(0, 8), max = cb.length ? cb[0].points : 1;
    b.innerHTML = '<div class="boards">' + res.map(function (x) {
      return '<article class="board"><div class="bh"><b>' + esc(x.program) + '</b><div class="meta">' + catPill(x.category) + '<span class="pill">' + esc(x.gender) + '</span>' +
        (x.gender === 'Rawdha' ? '' : '<span class="pill">' + esc(x.group) + '</span>') +
        (x.completed ? '<span class="pill st-3">✓ Completed</span>' : '') + '</div></div>' +
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
  var T = { q: '', group: '', cls: '', gender: '', program: '', status: '', view: 'entries', cat: 'Arts', pcat: 'Arts' };
  var TSel = {}; // ticked entry IDs for bulk change
  function viewTeacher() {
    var s = sessFor('teacher');
    if (!s) return loginCard('teacher', 'Teacher', 'Screen participants for each program. Your login is recorded.',
      fld('Teacher name', 'name', 'autocomplete="name" required') + fld('Phone number', 'phone', 'type="tel" inputmode="tel" required') +
      fld('Special access code', 'code', 'type="password" inputmode="numeric" autocomplete="off" required'), 'Open screening portal');
    var tabs = '<div class="subtabs" id="tView"><button data-tview="entries" class="' + (T.view === 'entries' ? 'on' : '') + '">Screening</button>' +
      '<button data-tview="programs" class="' + (T.view === 'programs' ? 'on' : '') + '">Program status</button>' +
      '<button data-tview="students" class="' + (T.view === 'students' ? 'on' : '') + '">Student status</button></div>';
    view.innerHTML = head('Screening stage', 'Teacher', 'Update each entry\'s status — changes save instantly to the sheet.', s) + tabs +
      (T.view === 'students'
        ? secSeg(T.gender, 'eSec') + '<div class="bigsearch" style="margin-bottom:12px"><input class="in" data-f="q" type="search" placeholder="Search chest no., name or phone" value="' + esc(T.q) + '" autocomplete="off"></div>' +
          '<div class="row" style="margin:0 0 10px;gap:12px"><p class="count grow" id="tCount" style="margin:0"></p><button class="btn sm gold" data-downloads="1">⬇ Downloads</button></div>' +
          '<div class="list" id="tList"><div class="loading"><span class="spin dark"></span></div></div>'
        : T.view === 'programs'
        ? catSeg(T.pcat, 'tCat') + secSeg(T.gender, 'eSec') + '<div class="toolbar t3"><select class="in" data-f="program">' + progOpts(T.program, 'All programs') + '</select><button class="btn gold" data-downloads="1">⬇ Downloads</button></div><div id="tList"></div>'
        : '<div class="notice info" style="margin:0 0 12px">Screening is for Arts items only — sports need no screening.</div>' +
          '<div id="tStats" class="stats"></div>' + entryToolbar(T) +
          '<div class="row" style="margin:0 0 10px;gap:12px"><label class="row small" style="gap:8px;font-weight:600;cursor:pointer"><input type="checkbox" id="tAll" style="width:20px;height:20px;accent-color:var(--green)">Select all shown</label>' +
          '<span class="count grow" id="tCount" style="margin:0"></span><button class="btn sm gold" data-downloads="1">⬇ Downloads</button></div>' +
          '<div class="list" id="tList"><div class="loading"><span class="spin dark"></span></div></div>' +
          '<div class="savebar" id="tBulk" hidden><span class="grow"><b id="tBulkN">0</b> selected</span>' +
          '<select class="in" id="tBulkSt" style="width:auto;min-height:40px;color:var(--ink)">' + opts(AB.SCREENING, '', 'Set status…') + '</select>' +
          '<button class="btn gold" id="tBulkGo">Apply</button><button class="btn ghost" id="tBulkClear" style="color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.4)">Clear</button></div>');
    view.onclick = function (e) {
      var tv = e.target.closest('[data-tview]'); if (tv) { T.view = tv.dataset.tview; viewTeacher(); return; }
      var so = e.target.closest('[data-student]'); if (so) { openStudent(so.dataset.student, s); return; }
      var tc = pickCat(e, 'tCat'); if (tc) { T.pcat = tc; T.program = ''; viewTeacher(); return; }
      if (e.target.closest('[data-downloads]')) { openDownloads(s.role === 'admin'); return; }
      if (e.target.closest('#tBulkGo')) { bulkScreen(s); return; }
      if (e.target.closest('#tBulkClear')) { TSel = {}; paintTeacher(); return; }
      var st = e.target.closest('[data-done]'); if (st) { setProgramStatus(st, s, st.dataset.prog, st.dataset.section, st.dataset.done, st.dataset.to); return; }
      var sc = pickSec(e, 'eSec'); if (sc != null) { T.gender = sc; paintTeacher(); }
    };
    view.oninput = view.onchange = function (e) {
      var t = e.target;
      if (t.dataset.f) { T[t.dataset.f] = t.value; paintTeacher(); return; }
      if (e.type === 'change' && t.dataset.pick) { if (t.checked) TSel[t.dataset.pick] = 1; else delete TSel[t.dataset.pick]; paintBulk(filterEntries(T).slice(0, 400)); return; }
      if (e.type === 'change' && t.id === 'tAll') {
        filterEntries(T).slice(0, 400).forEach(function (a) { if (t.checked) TSel[a.entry] = 1; else delete TSel[a.entry]; });
        paintTeacher(); return;
      }
      if (e.type === 'change' && t.dataset.entry) setScreening(t, s);
    };
    loadData(s).then(paintTeacher);
    every(function () { loadData(s).then(function () { if (!editingIn($('#tList'))) paintTeacher(); else updateBadges(); }); });
  }
  function entryToolbar(F) {
    return secSeg(F.gender, 'eSec') + '<div class="toolbar"><input class="in search" data-f="q" value="' + esc(F.q) + '" placeholder="Search name or chest no." type="search">' +
      '<select class="in" data-f="program">' + progOpts(F.program, 'All programs') + '</select>' +
      '<select class="in" data-f="group">' + opts(AB.GROUPS, F.group, 'All groups') + '</select>' +
      '<select class="in" data-f="cls">' + opts(AB.CLASSES, F.cls, 'All classes') + '</select>' +
      '<select class="in" data-f="status">' + opts(AB.SCREENING, F.status, 'All statuses') + '</select></div>';
  }
  function filterEntries(F) {
    var q = F.q.trim().toLowerCase();
    return (D.assignments || []).filter(function (a) {
      return (!F.cat || a.category === F.cat) && (!F.program || a.program === F.program) && (!F.group || a.group === F.group) && (!F.cls || a.cls === F.cls) &&
        (!F.gender || AB.sectionOf(a) === F.gender) && (!F.status || a.screening === F.status) &&
        (!q || String(a.chest).indexOf(q) === 0 || String(a.name || '').toLowerCase().indexOf(q) >= 0);
    }).sort(function (x, y) { return Number(x.chest) - Number(y.chest) || x.program.localeCompare(y.program); });
  }
  function paintTeacher() {
    if (!D || !$('#tList')) return;
    if (T.view === 'students') { paintStudents(); return; }
    if (T.view === 'programs') {
      $('#tList').innerHTML = programStatusHtml(AB.programList(D.assignments || [], D.scores || null, D.programStatus || []), { gender: T.gender, program: T.program, cat: T.pcat }, true);
      return;
    }
    var all = filterEntries(Object.assign({}, T, { status: '' }));
    $('#tStats').innerHTML = AB.SCREENING.map(function (st, i) {
      var n = all.filter(function (a) { return a.screening === st; }).length;
      return '<button class="stat" style="border:0;text-align:left;cursor:pointer;' + (T.status === st ? 'outline:2px solid var(--green)' : '') + '" data-status="' + esc(st) + '"><b class="pill st-' + i + '" style="font-size:22px;background:none;padding:0">' + n + '</b><span>' + esc(st) + '</span></button>';
    }).join('');
    $$('#tStats [data-status]').forEach(function (b) { b.onclick = function () { T.status = T.status === b.dataset.status ? '' : b.dataset.status; paintTeacher(); }; });
    var list = filterEntries(T);
    $('#tCount').textContent = list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') + (T.status ? ' · ' + T.status : '');
    $('#tList').innerHTML = list.length ? list.slice(0, 400).map(function (a) {
      return '<div class="item' + (TSel[a.entry] ? ' picked' : '') + '"><input type="checkbox" data-pick="' + esc(a.entry) + '"' + (TSel[a.entry] ? ' checked' : '') +
        ' aria-label="Select entry ' + esc(a.entry) + '" style="width:22px;height:22px;accent-color:var(--green);flex:none;margin:0">' +
        '<span class="chest">' + esc(a.chest) + '</span><div class="who"><b>' + esc(a.name) + '</b><div class="meta"><span>' + esc(a.cls) + '</span><span>' + esc(shortGroup(a.group)) + '</span><span>' + esc(a.gender) + '</span><span>Entry ' + esc(a.entry) + '</span></div></div>' +
        '<div class="acts">' + ci(a.chest, a.checkin) + '<span class="pill cat-' + esc(a.category) + '">' + esc(a.program) + '</span>' +
        '<select class="pill-sel st-' + stIdx(a.screening) + '" data-entry="' + esc(a.entry) + '" aria-label="Screening status for chest ' + esc(a.chest) + '">' + opts(AB.SCREENING, a.screening) + '</select></div></div>';
    }).join('') + (list.length > 400 ? '<div class="empty">Showing first 400 — use the filters to narrow down.</div>' : '') : '<div class="empty">No entries match these filters.</div>';
    paintBulk(list.slice(0, 400));
  }
  /** Bulk bar: shows how many are ticked; "Select all shown" reflects the visible list. */
  function paintBulk(shown) {
    var n = Object.keys(TSel).length, bar = $('#tBulk');
    if (!bar) return;
    bar.hidden = !n; $('#tBulkN').textContent = n;
    var all = $('#tAll');
    if (all && shown) { var k = shown.filter(function (a) { return TSel[a.entry]; }).length; all.checked = !!shown.length && k === shown.length; all.indeterminate = k > 0 && k < shown.length; }
    $$('#tList [data-pick]').forEach(function (c) { c.closest('.item').classList.toggle('picked', c.checked); });
  }
  function bulkScreen(s) {
    var ids = Object.keys(TSel), status = $('#tBulkSt').value, btn = $('#tBulkGo');
    if (!ids.length) return;
    if (!status) { toast('Choose a status to apply first.', true); $('#tBulkSt').focus(); return; }
    if (!confirm('Set ' + ids.length + ' entr' + (ids.length === 1 ? 'y' : 'ies') + ' to "' + status + '"?')) return;
    busy(btn, true, 'Saving…');
    api('screenMany', { token: s.token, entries: ids, status: status }).then(function (r) {
      busy(btn, false);
      if (!r.ok) { toast(r.error, true); if (r.auth) { setSession(s.role, null); route(); } return; }
      D.assignments.forEach(function (a) { if (TSel[a.entry]) { a.screening = status; a.screenedBy = s.name; } });
      TSel = {};
      toast(r.changed + ' entr' + (r.changed === 1 ? 'y' : 'ies') + ' set to ' + status);
      paintTeacher();
    });
  }
  /** Student status: one card per student; tap to open everything about them. */
  function paintStudents() {
    var q = T.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    var list = (D.registrations || []).filter(function (r) {
      if (T.gender && AB.sectionOf(r) !== T.gender) return false;
      if (!q) return true;
      return String(r.chest).indexOf(q) === 0 || String(r.name).toLowerCase().indexOf(q) >= 0 || (qd.length >= 3 && String(r.phone).indexOf(qd) >= 0);
    }).sort(function (a, b) { return Number(a.chest) - Number(b.chest); });
    $('#tCount').textContent = list.length + ' student' + (list.length === 1 ? '' : 's') + ' — tap a student to see everything';
    $('#tList').innerHTML = list.length ? list.slice(0, 200).map(function (r) {
      var en = (D.assignments || []).filter(function (a) { return String(a.chest) === String(r.chest); });
      var sel = en.filter(function (a) { return a.screening === 'Selected for Program'; }).length;
      return '<button class="item" data-student="' + esc(r.chest) + '" style="border:0;width:100%;text-align:left;cursor:pointer">' +
        '<span class="chest">' + esc(r.chest) + '</span><div class="who"><b>' + esc(r.name) + '</b><div class="meta"><span>' + esc(r.gender) + '</span><span>' + esc(r.cls) +
        '</span><span>' + esc(shortGroup(r.group)) + '</span><span>' + en.length + ' item' + (en.length === 1 ? '' : 's') + ' · ' + sel + ' selected</span></div></div>' +
        '<div class="acts">' + ci(r.chest, r.checkin) + '<span class="pill">View / Edit ›</span></div></button>';
    }).join('') : '<div class="empty">No student found.</div>';
  }
  function openStudent(chest, s) {
    var r = (D.registrations || []).filter(function (x) { return String(x.chest) === String(chest); })[0];
    if (!r) return;
    var en = (D.assignments || []).filter(function (a) { return String(a.chest) === String(chest); });
    var results = D.scores ? AB.computeResults(D.assignments, D.scores) : [];
    var hhmm = function (t) { return t ? esc(String(t).slice(5, 16)) : '—'; };
    var row = function (k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; };
    var items = en.map(function (a) {
      var st = statusOf(a.program, AB.sectionOf(a), AB.compGroup(a)), done = st && st.status === 'Completed';
      var res = '';
      if (D.scores) {
        var b = results.filter(function (x) { return x.program === a.program && x.gender === AB.sectionOf(a) && x.group === AB.compGroup(a); })[0];
        var e = b && b.entries.filter(function (x) { return String(x.chest) === String(chest); })[0];
        res = e ? '<span class="pill st-0">Score ' + e.avg + ' · Rank ' + e.rank + '</span>' : '<span class="pill">Not scored</span>';
      }
      return '<div class="place" style="border-top:1px solid var(--line);border-radius:0;padding:10px 2px;flex-wrap:wrap;gap:8px">' +
        '<div class="nm" style="min-width:160px"><b>' + esc(a.program) + '</b><span>Entry ' + esc(a.entry) + ' · ' + esc(a.category) + '</span></div>' +
        '<span class="pill ' + (done ? 'st-3' : 'st-1') + '">' + (done ? '✓ Completed' : 'Pending') + '</span>' + res +
        '<select class="pill-sel st-' + stIdx(a.screening) + '" data-entry="' + esc(a.entry) + '" aria-label="Screening status for ' + esc(a.program) + '">' + opts(AB.SCREENING, a.screening) + '</select></div>';
    }).join('');
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="card" style="max-width:620px">' +
      '<div class="row" style="margin-bottom:12px"><span class="chest lg">' + esc(r.chest) + '</span><div class="grow"><h3>' + esc(r.name) + '</h3>' +
      '<div class="small muted">' + esc(r.gender) + ' · ' + esc(r.cls) + ' · ' + esc(r.group) + '</div></div>' + ci(r.chest, r.checkin) +
      '<button type="button" class="btn sm ghost" data-close>Close</button></div>' +
      '<div class="review"><dl>' +
      row('Parent phone', esc(r.phone)) + row('Registered', hhmm(r.ts)) +
      row('Check-in', r.checkinAt ? hhmm(r.checkinAt) + ' by ' + esc(r.checkinBy) : '—') +
      row('Check-out', r.checkoutAt ? hhmm(r.checkoutAt) + ' by ' + esc(r.checkoutBy) : '—') +
      row('People with them', esc(Number(r.guests) || 0)) +
      '</dl></div>' +
      '<h3 style="margin:16px 0 4px">Items (' + en.length + ')</h3><div>' + (items || '<p class="muted small">No items.</p>') + '</div>' +
      '<h3 style="margin:16px 0 6px">Notes</h3>' + (r.notes ? '<div class="notes" style="background:var(--gold-l);border-radius:10px;padding:10px 12px;white-space:pre-line;font-size:13px">' + esc(r.notes) + '</div>' : '<p class="muted small" style="margin:0">No notes.</p>') +
      (s.role === 'admin' || s.role === 'teacher' ? '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-editstudent="' + esc(r.chest) + '">Edit details</button></div>' : '') +
      '</div>';
    document.body.appendChild(m);
    m.onclick = function (e) {
      if (e.target === m || e.target.closest('[data-close]')) { m.remove(); return; }
      var ed = e.target.closest('[data-editstudent]'); if (ed) { m.remove(); editReg(ed.dataset.editstudent, s); }
    };
    m.onchange = function (e) { if (e.target.dataset.entry) setScreening(e.target, s); };
  }
  // ===================== DOWNLOADS (PDF with logos + Excel/CSV) =====================
  var REPORTS = [
    ['students', 'Student list', 'Every student with class, group, phone, items and check-in'],
    ['screening', 'Screening list (Arts)', 'Arts entries by program with screening status'],
    ['programs', 'Program sheets', 'Every Arts & Sports program, participants by section and age group'],
    ['attendance', 'Attendance', 'Present / not present / checked out, times, people with them, notes'],
    ['classwise', 'Class-wise list', 'Students grouped by Madrasa class'],
    ['status', 'Program status', 'Pending and completed programs'],
    ['results', 'Results', 'Scores, averages and ranks (Admin only)']
  ];
  function ciTxt(st) { return st === AB.PRESENT ? 'Present' : st === AB.CHECKED_OUT ? 'Checked out' : 'Not present'; }
  function hm(t) { return t ? String(t).slice(5, 16) : ''; }
  /** Builds a report as { title, sections:[{ h, cols, rows, remarks }] }. sec = Boys/Girls/Rawdha filter. */
  function buildReport(kind, sec) {
    var regs = (D.registrations || []).filter(function (r) { return !sec || AB.sectionOf(r) === sec; })
      .sort(function (a, b) { return Number(a.chest) - Number(b.chest); });
    var ens = (D.assignments || []).filter(function (a) { return !sec || AB.sectionOf(a) === sec; });
    var items = function (r) { return AB.splitItems(r.sports).concat(AB.splitItems(r.arts)).join(', '); };
    var out = { title: '', sections: [] };
    if (kind === 'students') {
      out.title = 'Student list';
      out.sections.push({ h: regs.length + ' students', remarks: true, cols: ['#', 'Chest', 'Name', 'Gender', 'Class', 'Group', 'Parent phone', 'Items', 'Check-in'],
        rows: regs.map(function (r, i) { return [i + 1, r.chest, r.name, r.gender, r.cls, shortGroup(r.group), r.phone, items(r), ciTxt(r.checkin)]; }) });
    } else if (kind === 'screening' || kind === 'programs') {
      out.title = kind === 'screening' ? 'Screening list (Arts)' : 'Program sheets';
      var list = kind === 'screening' ? ens.filter(function (a) { return a.category === 'Arts'; }) : ens;
      var buckets = {};
      list.forEach(function (a) { var k = a.program + '|' + AB.sectionOf(a) + '|' + AB.compGroup(a); (buckets[k] = buckets[k] || []).push(a); });
      Object.keys(buckets).sort(function (x, y) {
        var X = x.split('|'), Y = y.split('|');
        return AB.allPrograms().indexOf(X[0]) - AB.allPrograms().indexOf(Y[0]) || AB.SECTIONS.indexOf(X[1]) - AB.SECTIONS.indexOf(Y[1]) || AB.ALL_GROUPS.indexOf(X[2]) - AB.ALL_GROUPS.indexOf(Y[2]);
      }).forEach(function (k) {
        var p = k.split('|'), en = buckets[k].sort(function (a, b) { return Number(a.chest) - Number(b.chest); });
        out.sections.push({ h: p[0] + ' · ' + p[1] + (p[1] === 'Rawdha' ? '' : ' · ' + shortGroup(p[2])) + ' (' + en.length + ')', remarks: true,
          cols: kind === 'screening' ? ['#', 'Chest', 'Name', 'Class', 'Check-in', 'Screening'] : ['#', 'Chest', 'Name', 'Class', 'Check-in', 'Score'],
          rows: en.map(function (a, i) { return kind === 'screening' ? [i + 1, a.chest, a.name, a.cls, ciTxt(a.checkin), a.screening] : [i + 1, a.chest, a.name, a.cls, ciTxt(a.checkin), '']; }) });
      });
    } else if (kind === 'attendance') {
      out.title = 'Attendance';
      var pres = regs.filter(function (r) { return r.checkin === AB.PRESENT; }), gone = regs.filter(function (r) { return r.checkin === AB.CHECKED_OUT; });
      var notIn = regs.filter(function (r) { return r.checkin !== AB.PRESENT && r.checkin !== AB.CHECKED_OUT; });
      var guests = pres.reduce(function (n, r) { return n + (Number(r.guests) || 0); }, 0);
      out.sections.push({ h: 'Summary', cols: ['Registered', 'Checked in now', 'People with them', 'Headcount now', 'Not present', 'Checked out'],
        rows: [[regs.length, pres.length, guests, pres.length + guests, notIn.length, gone.length]] });
      var att = function (r, i) { return [i + 1, r.chest, r.name, r.gender, r.cls, r.phone, Number(r.guests) || 0, hm(r.checkinAt), r.checkinBy || '', hm(r.checkoutAt), r.checkoutBy || '', String(r.notes || '').replace(/\n/g, ' | ')]; };
      var ac = ['#', 'Chest', 'Name', 'Gender', 'Class', 'Phone', 'With them', 'In', 'By', 'Out', 'By', 'Notes'];
      out.sections.push({ h: 'Checked in now (' + pres.length + ')', cols: ac, rows: pres.map(att) });
      out.sections.push({ h: 'Not present (' + notIn.length + ')', cols: ac, rows: notIn.map(att), remarks: true });
      out.sections.push({ h: 'Checked out (' + gone.length + ')', cols: ac, rows: gone.map(att) });
    } else if (kind === 'classwise') {
      out.title = 'Class-wise list';
      AB.CLASSES.forEach(function (c) {
        var rs = regs.filter(function (r) { return r.cls === c; }); if (!rs.length) return;
        out.sections.push({ h: c + ' (' + rs.length + ')', remarks: true, cols: ['#', 'Chest', 'Name', 'Gender', 'Group', 'Parent phone', 'Items', 'Check-in'],
          rows: rs.map(function (r, i) { return [i + 1, r.chest, r.name, r.gender, shortGroup(r.group), r.phone, items(r), ciTxt(r.checkin)]; }) });
      });
    } else if (kind === 'status') {
      out.title = 'Program status';
      var pl = AB.programList(D.assignments || [], D.scores || null, D.programStatus || []).filter(function (p) { return !sec || p.section === sec; });
      ['Pending', 'Completed'].forEach(function (st) {
        var rs = pl.filter(function (p) { return p.status === st; });
        out.sections.push({ h: st + ' (' + rs.length + ')', cols: ['#', 'Program', 'Category', 'Section', 'Group', 'Entries'].concat(D.scores ? ['Scored'] : []).concat(st === 'Completed' ? ['Marked by', 'Time'] : []),
          rows: rs.map(function (p, i) { return [i + 1, p.program, p.category, p.section, p.section === 'Rawdha' ? '' : shortGroup(p.group), p.entries].concat(D.scores ? [p.scored] : []).concat(st === 'Completed' ? [p.by || '', hm(p.ts)] : []); }) });
      });
    } else if (kind === 'results') {
      out.title = 'Results';
      AB.computeResults(D.assignments || [], D.scores || []).filter(function (b) { return !sec || b.gender === sec; }).forEach(function (b) {
        out.sections.push({ h: b.program + ' · ' + b.gender + (b.gender === 'Rawdha' ? '' : ' · ' + shortGroup(b.group)), cols: ['Rank', 'Chest', 'Name', 'Class', 'Average', 'Total', 'Judges'],
          rows: b.entries.map(function (e) { return [e.rank, e.chest, e.name, e.cls, e.avg, e.total, e.judges]; }) });
      });
    }
    return out;
  }
  function openDownloads(isAdmin) {
    if (!D) return;
    var sec = (current() === 'admin' ? A.F.gender : T.gender) || '';
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="card" style="max-width:560px"><div class="row" style="margin-bottom:6px"><h3 class="grow">⬇ Downloads</h3><button type="button" class="btn sm ghost" data-close>Close</button></div>' +
      '<p class="small muted" style="margin:0 0 10px">PDF has the logos and a Remarks column to write in. Excel opens in Excel / Google Sheets.' + (sec ? ' Showing <b>' + esc(sec) + '</b> only (from the Show buttons).' : '') + '</p>' +
      REPORTS.filter(function (r) { return r[0] !== 'results' || (isAdmin && D.scores); }).map(function (r) {
        return '<div class="place" style="border-top:1px solid var(--line);border-radius:0;padding:10px 2px;gap:8px;flex-wrap:wrap"><div class="nm" style="min-width:180px"><b>' + r[1] + '</b><span>' + r[2] + '</span></div>' +
          '<button class="btn sm" data-rep="' + r[0] + '" data-fmt="pdf">PDF</button><button class="btn sm ghost" data-rep="' + r[0] + '" data-fmt="csv">Excel</button></div>';
      }).join('') + '</div>';
    document.body.appendChild(m);
    m.onclick = function (e) {
      if (e.target === m || e.target.closest('[data-close]')) { m.remove(); return; }
      var b = e.target.closest('[data-rep]'); if (!b) return;
      var rep = buildReport(b.dataset.rep, sec);
      if (!rep.sections.some(function (x) { return x.rows.length; })) { toast('Nothing to download yet.', true); return; }
      if (b.dataset.fmt === 'csv') downloadCSV(rep, sec); else { m.remove(); printReport(rep, sec); }
    };
  }
  function fileName(rep, sec, ext) { return 'AlBahja-' + rep.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/-$/, '') + (sec ? '-' + sec : '') + '-' + new Date().toISOString().slice(0, 10) + '.' + ext; }
  function downloadCSV(rep, sec) {
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = ['Al Bahja Madrasa Meet 26 - ' + rep.title + (sec ? ' - ' + sec : ''), ''];
    rep.sections.forEach(function (x) {
      lines.push(q(x.h)); lines.push(x.cols.concat(x.remarks ? ['Remarks'] : []).map(q).join(','));
      x.rows.forEach(function (r) { lines.push(r.concat(x.remarks ? [''] : []).map(q).join(',')); });
      lines.push('');
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(rep, sec, 'csv');
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('Downloaded ' + rep.title + ' (Excel)');
  }
  function printReport(rep, sec) {
    var who = (sessFor(current() === 'admin' ? 'admin' : 'teacher') || {}).name || '', now = new Date();
    var body = rep.sections.map(function (x) {
      return '<h2>' + esc(x.h) + '</h2>' + (x.rows.length ? '<table><tr>' + x.cols.concat(x.remarks ? ['Remarks'] : []).map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>' +
        x.rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return '<td>' + (x.cols[i] === 'Chest' ? '<span class="pchest">' + esc(v) + '</span>' : x.cols[i] === 'Name' ? '<b>' + esc(v) + '</b>' : esc(v)) + '</td>'; }).join('') + (x.remarks ? '<td class="rm"></td>' : '') + '</tr>'; }).join('') + '</table>'
        : '<p style="color:#5E6B62;margin:0">None.</p>');
    }).join('');
    var sheet = $('#printSheet') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'printSheet' }));
    sheet.innerHTML = '<div class="ps"><div class="ps-head"><img class="lg" src="assets/logo.png" alt="Al Bahja"><div><h1>Al Bahja Madrasa Meet \'26 — ' + esc(rep.title) + '</h1>' +
      '<p>' + (sec ? esc(sec) + ' · ' : '') + 'Printed ' + now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (who ? ' by ' + esc(who) : '') + '</p></div>' +
      '<img class="sv" src="assets/sarga.png" alt="Sarga Vasantham"></div>' + body + '<p class="foot">Fri, 4 Dec 2026 · Saihat Istiraha, Dhahran–Jubail Highway</p></div>';
    var imgs = $$('img', sheet), left = imgs.length;
    var go = function () { document.title = fileName(rep, sec, 'pdf').replace(/\.pdf$/, ''); document.body.classList.add('printing'); setTimeout(function () { window.print(); }, 60); };
    var done = function () { if (--left <= 0) go(); };
    imgs.forEach(function (im) { if (im.complete) done(); else { im.onload = done; im.onerror = done; } });
  }
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); document.title = 'Al Bahja Madrasa Meet'; });

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
  function current() { return location.hash.replace('#', '') || 'home'; }

  // =====================================================================
  // 4. VOLUNTEER CHECK-IN
  // =====================================================================
  var V = { q: '', show: '', sec: '' };
  function viewVolunteer() {
    var s = sessFor('volunteer');
    if (!s) return loginCard('volunteer', 'Check In', 'Mark arrivals at the desk. Your name and phone are logged.',
      fld('Volunteer name', 'name', 'autocomplete="name" required') + fld('Phone number', 'phone', 'type="tel" inputmode="tel" required') +
      fld('Check-in code', 'code', 'type="password" inputmode="numeric" autocomplete="off" required'), 'Open check-in desk');
    view.innerHTML = head('Check-in desk', 'Check In', 'Search by chest number, name or phone. You can mark attendance and add notes — registration details stay locked.', s) +
      '<div class="stats" id="vStats"></div>' + secSeg(V.sec, 'vSec') + '<div class="bigsearch" style="margin-bottom:12px"><input class="in" id="vq" type="search" inputmode="search" placeholder="Chest no., name or phone" value="' + esc(V.q) + '" autocomplete="off"></div>' +
      '<div class="row" style="margin-bottom:14px"><div class="seg" id="vShow">' + [['', 'All'], [AB.PRESENT, 'Present'], [AB.ABSENT, 'Not Present'], [AB.CHECKED_OUT, 'Checked out']].map(function (x) {
        return '<button data-show="' + x[0] + '" class="' + (V.show === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div><span class="count grow" id="vCount" style="margin:0;text-align:right"></span></div>' +
      '<div class="list" id="vList"><div class="loading"><span class="spin dark"></span></div></div>';
    $('#vq').focus();
    view.oninput = function (e) { if (e.target.id === 'vq') { V.q = e.target.value; paintVolunteer(); } };
    view.onchange = function (e) {
      var g = e.target.dataset.guests; if (g == null) return;
      var r = D.registrations.filter(function (x) { return String(x.chest) === String(g); })[0];
      if (!r || r.checkin !== AB.PRESENT) return; // saved with "Mark present" for others
      if (!lockChest(g)) return;
      paintVolunteer();
      api('setGuests', { token: s.token, chest: g, guests: e.target.value }).then(function (res) {
        unlockChest(g);
        if (!res.ok) { toast(res.error, true); paintVolunteer(); return; }
        r.guests = res.guests; toast('Chest ' + g + ' · ' + res.guests + ' with them'); paintVolunteer();
      });
    };
    view.onkeydown = function (e) { if (e.key === 'Enter' && e.target.dataset.notefor) { e.preventDefault(); addNote(e.target.dataset.notefor, s); } };
    view.onclick = function (e) {
      var sc = pickSec(e, 'vSec'); if (sc != null) { V.sec = sc; paintVolunteer(); return; }
      var sh = e.target.closest('[data-show]'); if (sh) { V.show = sh.dataset.show; $$('#vShow button').forEach(function (b) { b.classList.toggle('on', b === sh); }); paintVolunteer(); return; }
      var co = e.target.closest('[data-checkout]'); if (co) { checkOut(co, s); return; }
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
    var outs = regs.filter(function (r) { return r.checkin === AB.CHECKED_OUT; }).length;
    var withThem = regs.reduce(function (n, r) { return n + (r.checkin === AB.PRESENT ? (Number(r.guests) || 0) : 0); }, 0);
    $('#vStats').innerHTML = '<div class="stat g"><b>' + pres + '</b><span>Students checked in now</span></div>' +
      '<div class="stat y"><b>' + (pres + withThem) + '</b><span>Headcount now<br><small>' + pres + ' students + ' + withThem + ' with them</small></span></div>' +
      '<div class="stat r"><b>' + (regs.length - pres - outs) + '</b><span>Not present</span></div>' +
      '<div class="stat"><b>' + outs + '</b><span>Checked out</span></div><div class="stat"><b>' + regs.length + '</b><span>Registered</span></div>';
    var q = V.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    var list = regs.filter(function (r) {
      if (V.show && r.checkin !== V.show) return false;
      if (V.sec && AB.sectionOf(r) !== V.sec) return false;
      if (!q) return true;
      return String(r.chest) === q || String(r.chest).indexOf(q) === 0 || String(r.name).toLowerCase().indexOf(q) >= 0 || (qd.length >= 3 && String(r.phone).indexOf(qd) >= 0);
    }).sort(function (a, b) {
      if (q && String(a.chest) === q) return -1; if (q && String(b.chest) === q) return 1;
      return Number(a.chest) - Number(b.chest);
    });
    $('#vCount').textContent = list.length + ' student' + (list.length === 1 ? '' : 's');
    $('#vList').innerHTML = list.length ? list.slice(0, 150).map(function (r) {
      var on = r.checkin === AB.PRESENT, gone = r.checkin === AB.CHECKED_OUT;
      var items = AB.splitItems(r.sports).concat(AB.splitItems(r.arts));
      var hhmm = function (t) { return esc(String(t || '').slice(11, 16)); };
      var wait = !!inFlight[String(r.chest)], dis = wait ? ' disabled' : '';
      return '<div class="vcard"><span class="chest lg">' + esc(r.chest) + '</span><div><div class="row" style="gap:8px"><b style="font-size:16px">' + esc(r.name) + '</b>' + ci(r.chest, r.checkin) + '</div>' +
        '<div class="meta small muted" style="margin-top:3px">' + esc(r.gender) + ' · ' + esc(r.cls) + ' · ' + esc(shortGroup(r.group)) + ' · ' + esc(r.phone) + '</div>' +
        '<div class="small" style="margin-top:6px">' + items.map(esc).join(' · ') + '</div>' +
        ((on || gone) && r.checkinAt ? '<div class="small muted" style="margin-top:4px">' + (Number(r.guests) ? Number(r.guests) + ' with them · ' : '') + 'Checked in ' + hhmm(r.checkinAt) + ' by ' + esc(r.checkinBy) +
          (gone && r.checkoutAt ? ' · Checked out ' + hhmm(r.checkoutAt) + ' by ' + esc(r.checkoutBy) : '') + '</div>' : '') + '</div>' +
        (gone ? '<div class="tog" style="text-align:center;font-weight:600;color:var(--muted);padding:11px 0">Checked out</div>'
          : '<div style="display:flex;flex-direction:column;gap:8px"><label class="small" style="display:flex;align-items:center;gap:8px;justify-content:space-between;font-weight:600">People with them' +
            '<input class="in" style="width:72px;min-height:38px;padding:6px 10px;text-align:center" type="number" inputmode="numeric" min="0" max="30" data-guests="' + esc(r.chest) + '" value="' + esc(Number(r.guests) || 0) + '"' + dis + '></label>' +
            (wait ? '<button class="btn tog" disabled style="pointer-events:none;opacity:.7"><span class="spin"></span>Saving…</button>'
              : (on ? '<div class="btn tog isin" style="cursor:default" aria-label="Checked in">✓ Checked in</div>'
                : '<button class="btn tog isout" data-toggle="' + esc(r.chest) + '">Mark present</button>') +
              (on ? '<button class="btn tog ghost" data-checkout="' + esc(r.chest) + '">Check out</button>' : '')) + '</div>') +
        (r.notes ? '<div class="notes">' + esc(r.notes) + '</div>' : '') +
        '<div class="addnote"><input class="in" data-notefor="' + esc(r.chest) + '" placeholder="Note (optional) — saved with check-in / check-out, or press Add note" maxlength="300"' + dis + '><button class="btn sm ghost" data-addnote="' + esc(r.chest) + '"' + dis + '>Add note</button></div></div>';
    }).join('') + (list.length > 150 ? '<div class="empty">Showing first 150 — search to narrow down.</div>' : '') : '<div class="empty">No student found. Check the chest number or try the name / phone.</div>';
  }
  /** One save at a time per child: buttons stay locked until the server answers. */
  var inFlight = {};
  function lockChest(c) { c = String(c); if (inFlight[c]) return false; inFlight[c] = 1; return true; }
  function unlockChest(c) { delete inFlight[String(c)]; }
  /** "Check-in done" pop-up; closes itself after a few seconds. */
  function checkinDone(r, guests) {
    var old = $('#ciDone'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'modal'; m.id = 'ciDone';
    m.innerHTML = '<div class="card" style="max-width:360px;text-align:center;padding:28px 24px">' +
      '<div style="width:64px;height:64px;border-radius:50%;background:var(--ok-l);color:var(--ok);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:34px;font-weight:700">✓</div>' +
      '<h2 style="margin-bottom:6px">Check-in done</h2>' +
      '<div class="chest lg" style="margin:6px auto 10px">' + esc(r.chest) + '</div>' +
      '<div style="font-weight:600">' + esc(r.name) + '</div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(r.gender) + ' · ' + esc(r.cls) + (guests ? ' · ' + guests + ' with them' : '') + ' · ' +
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div>' +
      '<button class="btn block" style="margin-top:18px" data-close>OK</button></div>';
    document.body.appendChild(m);
    var close = function () { if (m.parentNode) m.remove(); };
    m.onclick = function (e) { if (e.target === m || e.target.closest('[data-close]')) close(); };
    setTimeout(close, 4000);
  }
  function checkOut(btn, s) {
    var chest = btn.dataset.checkout;
    var r = D.registrations.filter(function (x) { return String(x.chest) === String(chest); })[0];
    if (inFlight[String(chest)]) return;
    if (!confirm('Check out chest ' + chest + (r ? ' — ' + r.name : '') + '?\nThis is final for volunteers.')) return;
    if (!lockChest(chest)) return;
    busy(btn, true, '');
    var ni = $('[data-notefor="' + chest + '"]');
    var note = ni ? ni.value.trim() : '';
    if (current() !== 'admin') paintVolunteer();
    api('checkin', { token: s.token, chest: chest, status: AB.CHECKED_OUT, note: note }).then(function (res) {
      unlockChest(chest);
      if (!res.ok) { busy(btn, false); toast(res.error, true); if (res.auth) { setSession(s.role, null); route(); } else if (current() !== 'admin') paintVolunteer(); return; }
      if (ni) ni.value = '';
      toast('Chest ' + chest + ' · checked out');
      loadData(s).then(function () { if (current() === 'admin') paintAdmin(); else paintVolunteer(); });
    });
  }
  function toggleCheckin(btn, s) {
    var chest = btn.dataset.toggle;
    var r = D.registrations.filter(function (x) { return String(x.chest) === String(chest); })[0];
    if (r.checkin === AB.CHECKED_OUT && current() !== 'admin') { toast('Chest ' + chest + ' is already checked out.', true); return; }
    var to = r.checkin === AB.PRESENT ? AB.ABSENT : AB.PRESENT;
    if (!lockChest(chest)) return;
    var ni = $('[data-notefor="' + chest + '"]');
    busy(btn, true, '');
    var gi = $('[data-guests="' + chest + '"]');
    var note = ni ? ni.value.trim() : '', guests = gi ? gi.value : '';
    if (current() !== 'admin') paintVolunteer();
    api('checkin', { token: s.token, chest: chest, status: to, note: note, guests: guests }).then(function (res) {
      unlockChest(chest);
      if (!res.ok) { busy(btn, false); toast(res.error, true); if (res.auth) { setSession(s.role, null); route(); } else if (current() !== 'admin') paintVolunteer(); return; }
      if (to === AB.PRESENT) checkinDone(r, Number(guests) || 0);
      else toast('Chest ' + chest + ' · marked not present');
      loadData(s).then(function () { if (current() === 'admin') paintAdmin(); else paintVolunteer(); });
    });
  }
  function addNote(chest, s) {
    var inp = $('[data-notefor="' + chest + '"]'); var text = inp && inp.value.trim();
    if (!text) { if (inp) inp.focus(); return; }
    if (!lockChest(chest)) return;
    paintVolunteer();
    api('note', { token: s.token, chest: chest, note: text }).then(function (r) {
      unlockChest(chest);
      if (!r.ok) paintVolunteer();
      inp = $('[data-notefor="' + chest + '"]') || inp;
      if (!r.ok) { toast(r.error, true); return; }
      inp.value = ''; inp.blur(); toast('Note added to chest ' + chest);
      loadData(s).then(paintVolunteer);
    });
  }

  // =====================================================================
  // 5. JUDGE SCORING
  // =====================================================================
  var J = { gender: 'Boys', group: '', selectedOnly: false, program: '', dirty: false, teams: {} };
  var TEAM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  function viewJudge() {
    var s = sessFor('judge');
    if (!s) return loginCard('judge', 'Judge Panel', 'Choose the program you are judging. Participants are shown by chest number only.',
      fld('Judge name', 'name', 'autocomplete="name" required') +
      '<div class="field"><label class="f" for="f_program">Program / event</label><select class="in" id="f_program" name="program">' + progOpts('', 'Select program') + '</select></div>' +
      fld('Program code <span class="muted" style="font-weight:400">(each program has its own code)</span>', 'code', 'type="password" inputmode="numeric" autocomplete="off" required'), 'Start judging');
    var isAdmin = s.role === 'admin';
    var allowedProgs = isAdmin ? AB.allPrograms() : (D && D.programs && D.programs.length ? D.programs : (AB.codeKey(s.program) === AB.ALL_SPORTS ? AB.SPORTS : [s.program]));
    var program = allowedProgs.indexOf(J.program) >= 0 ? J.program : (isAdmin ? AB.ARTS_BOYS[0] : s.program);
    var canSwitch = allowedProgs.length > 1;
    J.program = program;
    var cat = AB.categoryOf(program), allowed = AB.gendersFor(program);
    if (allowed.indexOf(J.gender) < 0) J.gender = allowed[0] || 'Boys';
    view.innerHTML = head('Judge Panel', 'Judging: ' + esc(program) + ' ' + catPill(cat), 'Score each chest number out of 100. You can change your marks until results are final.', s) +
      '<div class="toolbar jbar" style="grid-template-columns:' + (canSwitch ? '1.4fr ' : '') + 'auto 1fr auto">' +
      (canSwitch ? '<select class="in" id="jProg">' + (isAdmin ? progOpts(program) : '<optgroup label="Sports events">' + opts(allowedProgs, program) + '</optgroup>') + '</select>' : '') +
      '<div class="seg" id="jGender">' + AB.SECTIONS.map(function (g) { var dis = allowed.indexOf(g) < 0; return '<button data-g="' + g + '" class="' + (J.gender === g ? 'on' : '') + '"' + (dis ? ' disabled title="' + esc(allowed[0] || '') + ' only" style="opacity:.4"' : '') + '>' + g + '</button>'; }).join('') + '</div>' +
      (J.gender === 'Rawdha' ? '<div class="in" style="display:flex;align-items:center;color:var(--muted)">Rawdha 1 &amp; 2 together</div>'
        : '<select class="in" id="jGroup">' + opts(AB.GROUPS, J.group, 'All age groups') + '</select>') +
      (cat === 'Sports' ? '<span></span>' : '<label class="pick' + (J.selectedOnly ? ' on' : '') + '" style="min-height:46px"><input type="checkbox" id="jSel"' + (J.selectedOnly ? ' checked' : '') + '>Selected for program only</label>') + '</div>' +
      (AB.TEAM_SPORTS.indexOf(program) >= 0 ? '<div class="notice info" style="margin:0 0 12px">Team sport: put each chest number in a team, type the team\'s score below and press <b>Apply</b> — every member gets the same score. You can still change any single score by hand.</div><div id="jTeams"></div>' : '') +
      '<div class="list" id="jList"><div class="loading"><span class="spin dark"></span></div></div>' +
      '<div class="savebar"><span class="grow" id="jSum"></span><button class="btn gold" id="jSave">Submit scores</button></div>';
    view.onclick = function (e) {
      var g = e.target.closest('[data-g]'); if (g && !g.disabled) { J.gender = g.dataset.g; viewJudge(); return; }
      var st = e.target.closest('[data-done]'); if (st) { setProgramStatus(st, s, J.program, J.gender, st.dataset.done, st.dataset.to); return; }
      if (e.target.closest('#jSave')) saveScores(s);
    };
    view.onchange = function (e) {
      if (e.target.id === 'jGroup') { J.group = e.target.value; paintJudge(); }
      if (e.target.id === 'jSel') { J.selectedOnly = e.target.checked; e.target.parentNode.classList.toggle('on', J.selectedOnly); paintJudge(); }
      if (e.target.id === 'jProg') { if (J.dirty && !confirm('Discard unsaved scores?')) { e.target.value = J.program; return; } J.program = e.target.value; J.dirty = false; J.teams = {}; viewJudge(); }
    };
    view.oninput = function (e) { if (e.target.dataset.score != null || e.target.dataset.remarks != null) { J.dirty = true; paintJudgeSum(); } };
    var baseChange = view.onchange;
    view.onchange = function (e) {
      if (e.target.dataset.team != null) { J.teams[e.target.dataset.team] = e.target.value; J.dirty = true; paintTeamBar(); paintJudgeSum(); return; }
      baseChange(e);
    };
    var baseClick = view.onclick;
    view.onclick = function (e) {
      var ap = e.target.closest('[data-applyteam]');
      if (ap) {
        var tl = ap.dataset.applyteam, inp = $('[data-teamscore="' + tl + '"]'), v = inp && inp.value;
        if (v === '' || isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100) { toast('Enter a team score from 0 to 100.', true); if (inp) inp.focus(); return; }
        var n = 0;
        $$('[data-score]').forEach(function (x) { if (J.teams[x.dataset.score] === tl) { x.value = v; n++; } });
        J.dirty = true; paintJudgeSum(); toast('Team ' + tl + ': ' + v + ' given to ' + n + ' player' + (n === 1 ? '' : 's') + ' — press Submit scores to save');
        return;
      }
      baseClick(e);
    };
    loadData(s).then(paintJudge);
    every(function () { loadData(s).then(function () { if (J.dirty || editingIn($('#jList'))) updateBadges(); else paintJudge(); }); });
  }
  function judgeEntries() {
    return (D.assignments || []).filter(function (a) {
      return a.program === J.program && AB.sectionOf(a) === J.gender && (J.gender === 'Rawdha' || !J.group || a.group === J.group) &&
        (!J.selectedOnly || a.screening === 'Selected for Program');
    }).sort(function (x, y) { return AB.ALL_GROUPS.indexOf(AB.compGroup(x)) - AB.ALL_GROUPS.indexOf(AB.compGroup(y)) || Number(x.chest) - Number(y.chest); });
  }
  function myScore(chest) {
    var me = sessFor('judge').name;
    return (D.scores || []).filter(function (x) { return x.program === J.program && String(x.chest) === String(chest) && x.judge === me; })[0];
  }
  function paintJudge() {
    if (!D || !$('#jList')) return;
    var list = judgeEntries(), lastGroup = null, team = AB.TEAM_SPORTS.indexOf(J.program) >= 0;
    if (team && !J.dirty) list.forEach(function (a) { var m0 = myScore(a.chest); if (m0 && m0.team && J.teams[a.chest] == null) J.teams[a.chest] = m0.team; });
    $('#jList').innerHTML = list.length ? list.map(function (a) {
      var m = myScore(a.chest), sep = '';
      var cg = AB.compGroup(a);
      if (cg !== lastGroup) { lastGroup = cg; sep = groupHead(J.program, J.gender, cg); }
      return sep + '<div class="jrow' + (m ? ' saved' : '') + '"><span class="chest lg">' + esc(a.chest) + '</span>' +
        '<div><div class="row" style="gap:6px">' + ci(a.chest, a.checkin) +
          (team ? '<select class="pill-sel" data-team="' + esc(a.chest) + '" aria-label="Team for chest ' + esc(a.chest) + '" style="background-color:#E3F1FF;color:#1F5FAE">' +
            '<option value="">No team</option>' + TEAM_LETTERS.map(function (t) { return '<option value="' + t + '"' + (J.teams[a.chest] === t ? ' selected' : '') + '>Team ' + t + '</option>'; }).join('') + '</select>' : '') +
          '</div>' + (m ? '<div class="small" style="margin-top:4px;color:var(--ok)">saved ' + esc(m.score) + (m.team ? ' · Team ' + esc(m.team) : '') + '</div>' : '') + '</div>' +
        '<input class="in score" data-score="' + esc(a.chest) + '" type="number" inputmode="decimal" min="0" max="100" step="0.5" placeholder="/100" value="' + (m ? esc(m.score) : '') + '" aria-label="Score for chest ' + esc(a.chest) + '">' +
        '<input class="in rm" data-remarks="' + esc(a.chest) + '" placeholder="Remarks (optional)" value="' + (m ? esc(m.remarks) : '') + '" maxlength="200"></div>';
    }).join('') : '<div class="empty">No participants for ' + esc(J.program) + ' · ' + esc(J.gender) + (J.group ? ' · ' + esc(J.group) : '') + (J.selectedOnly ? ' (selected only)' : '') + '.</div>';
    paintTeamBar();
    paintJudgeSum();
  }
  /** Team score boxes for the teams in use (team sports only). */
  function paintTeamBar() {
    var bar = $('#jTeams'); if (!bar) return;
    var shown = {}; $$('[data-team]').forEach(function (x) { if (x.value) shown[x.value] = (shown[x.value] || 0) + 1; });
    var used = TEAM_LETTERS.filter(function (t) { return shown[t]; });
    var keep = {}; $$('[data-teamscore]').forEach(function (x) { keep[x.dataset.teamscore] = x.value; });
    bar.innerHTML = used.length ? '<div class="card" style="padding:14px;margin-bottom:12px"><h3 style="margin-bottom:10px">Team scores</h3><div class="row" style="gap:10px">' +
      used.map(function (t) {
        return '<div class="row" style="gap:6px;background:var(--green-ll);border-radius:12px;padding:6px 8px"><b>Team ' + t + '</b><span class="small muted">(' + shown[t] + ')</span>' +
          '<input class="in" style="width:80px;min-height:38px;text-align:center" type="number" inputmode="decimal" min="0" max="100" step="0.5" placeholder="/100" data-teamscore="' + t + '" value="' + esc(keep[t] || '') + '">' +
          '<button class="btn sm gold" data-applyteam="' + t + '">Apply</button></div>';
      }).join('') + '</div></div>'
      : '<p class="small muted" style="margin:0 0 12px">Choose a team for each chest number to get team score boxes here.</p>';
  }
  /** Program status per section + group: a Completed tag with Mark completed / Reopen (label only). */
  function statusOf(program, section, group) {
    var k = AB.statusKey(program, section, group);
    return (D && D.programStatus || []).filter(function (r) { return AB.statusKey(r.program, r.section, r.group) === k; })[0];
  }
  function doneBtn(program, section, group) {
    var r = statusOf(program, section, group), done = r && r.status === 'Completed';
    return (done ? '<span class="pill st-3" title="' + esc('by ' + r.by + ' · ' + r.ts) + '">✓ Completed</span>' : '') +
      '<button type="button" class="btn sm ' + (done ? 'ghost' : 'gold') + '" data-done="' + esc(group) + '" data-prog="' + esc(program) +
      '" data-section="' + esc(section) + '" data-to="' + (done ? 'Open' : 'Completed') + '">' + (done ? 'Reopen' : 'Mark completed') + '</button>';
  }
  function groupHead(program, section, group) {
    return '<div class="row" style="margin:12px 0 0;gap:10px"><h3 class="grow">' + esc(group) + '</h3>' + doneBtn(program, section, group) + '</div>';
  }
  function setProgramStatus(btn, s, program, section, group, to) {
    busy(btn, true, '');
    api('setStatus', { token: s.token, program: program, section: section, group: group, status: to }).then(function (r) {
      busy(btn, false);
      if (!r.ok) { toast(r.error, true); if (r.auth) { setSession(s.role, null); route(); } return; }
      toast(program + ' · ' + section + ' · ' + group + ' — ' + (to === 'Completed' ? 'marked completed' : 'reopened'));
      loadData(s).then(function () { var c = current(); if (c === 'admin') paintAdminList(); else if (c === 'teacher') paintTeacher(); else paintJudge(); });
    });
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
      entries.push({ chest: inp.dataset.score, score: v, remarks: rm ? rm.value : '', team: J.teams[inp.dataset.score] || '' });
    });
    if (bad) { toast('Scores must be between 0 and 100.', true); bad.focus(); return; }
    if (!entries.length) { toast('Enter at least one score first.', true); return; }
    var btn = $('#jSave'); busy(btn, true);
    api('score', { token: s.token, program: J.program, entries: entries }).then(function (r) {
      busy(btn, false);
      if (!r.ok) { toast(r.error, true); if (r.auth) { setSession(s.role, null); route(); } return; }
      J.dirty = false; J.teams = {}; toast(r.saved + ' score' + (r.saved === 1 ? '' : 's') + ' saved — scoreboard updated');
      loadData(s).then(paintJudge);
    });
  }

  // =====================================================================
  // 6. ADMIN
  // =====================================================================
  var A = { tab: 'overview', q: '', F: { q: '', group: '', cls: '', gender: '', program: '', status: '', cat: 'Arts' }, resProg: '' };
  var TABS = [['overview', 'Overview'], ['regs', 'Registrations'], ['entries', 'Program Entries'], ['scores', 'Scores'], ['results', 'Results'], ['programs', 'Programs'], ['judges', 'Judges'], ['logs', 'Staff Logs']];
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
      '<button class="btn gold sm" data-downloads="1">⬇ Downloads</button><button class="btn ghost sm" data-export="1">Export this tab (CSV)</button><button class="btn ghost sm" data-refresh="1">Refresh</button>' +
      (DEMO ? '<span class="grow"></span><button class="btn sm gold" data-seed="1">Load sample data</button><button class="btn sm danger" data-reset="1">Reset demo</button>' : '');
    $$('#aTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === A.tab); });
    var b = $('#aBody');
    if (A.tab === 'overview') b.innerHTML = '<div id="aList"></div>';
    else if (A.tab === 'entries') b.innerHTML = catSeg(A.F.cat, 'aCat') + entryToolbar(A.F) + '<p class="count" id="aCount"></p><div id="aList"></div>';
    else if (A.tab === 'programs') b.innerHTML = catSeg(A.F.cat, 'aCat') + secSeg(A.F.gender, 'aSec') + '<div class="toolbar t3"><select class="in" id="resProg">' + progOpts(A.resProg, 'All programs') + '</select></div><div id="aList"></div>';
    else if (A.tab === 'results') b.innerHTML = catSeg(A.F.cat, 'aCat') + secSeg(A.F.gender, 'aSec') + '<div class="toolbar t3"><select class="in" id="resProg">' + progOpts(A.resProg, 'All programs') + '</select></div><div id="aList"></div>';
    else b.innerHTML = (A.tab === 'regs' ? secSeg(A.F.gender, 'aSec') : A.tab === 'scores' ? catSeg(A.F.cat, 'aCat') : '') + '<div class="toolbar t3"><input class="in search" type="search" data-aq="1" placeholder="Search…" value="' + esc(A.q) + '"></div><p class="count" id="aCount"></p><div id="aList"></div>';
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
      var list = regs.filter(function (r) { return match(r, A.q) && (!A.F.gender || AB.sectionOf(r) === A.F.gender); }).sort(function (a, b) { return Number(a.chest) - Number(b.chest); });
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
      var sl = sc.filter(function (x) { return match(x, A.q) && AB.categoryOf(x.program) === A.F.cat; }).sort(function (a, b) { return a.program.localeCompare(b.program) || Number(a.chest) - Number(b.chest); });
      setCount(sl.length, 'marks');
      el.innerHTML = table(['Program', 'Group', 'Chest', 'Name', 'Judge', 'Score', 'Remarks', 'Time', ''], sl.map(function (x, i) {
        return '<tr><td>' + esc(x.program) + '</td><td>' + esc(shortGroup(x.group)) + '</td><td><span class="chest">' + esc(x.chest) + '</span> ' + ci(x.chest, checkinOf(x.chest)) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.judge) + '</td><td class="num"><b>' + esc(x.score) + '</b></td><td class="small">' + esc(x.remarks) + '</td><td class="small muted">' + esc(x.ts) + '</td>' +
          '<td style="white-space:nowrap"><button class="btn sm ghost" data-editscore="' + i + '">Edit</button> <button class="btn sm danger" data-delscore="' + i + '">Delete</button></td></tr>';
      }));
      A._scoreList = sl;
    } else if (A.tab === 'judges') {
      var logs = (D.staffLogs || []).filter(function (l) { return l.role === 'Judge'; });
      var codes = D.judgeCodes || [];
      setCount(codes.length, 'programs');
      el.innerHTML = '<p class="muted small" style="margin:0 0 10px">Give each judge only the code for their program. Only Admin can see this page.</p>' +
        table(['Program', 'Judge code', 'Judges logged in', ''], AB.codeKeys().filter(function (p) { return !A.q || p.toLowerCase().indexOf(A.q.toLowerCase()) >= 0; }).map(function (p) {
          var c = codes.filter(function (x) { return x.program === p; })[0];
          var sports = p === AB.ALL_SPORTS;
          var who = {}; logs.forEach(function (l) { var lp = String(l.detail || '').replace('Program: ', ''); if (AB.codeKey(lp) === p) who[l.name + (sports ? ' (' + lp + ')' : '')] = l.ts; });
          var names = Object.keys(who);
          return '<tr><td><b>' + esc(p) + '</b><div class="small muted">' + (sports ? 'One code for every sports event: ' + esc(AB.SPORTS.join(', ')) : esc(AB.categoryOf(p)) + ' · ' + esc(AB.gendersFor(p).join(', '))) + '</div></td>' +
            '<td><span class="chest" style="min-width:90px;letter-spacing:2px">' + esc(c ? c.code : '—') + '</span></td>' +
            '<td class="small">' + (names.length ? names.map(function (n) { return '<div><b>' + esc(n) + '</b> <span class="muted">· last ' + esc(String(who[n]).slice(5, 16)) + '</span></div>'; }).join('') : '<span class="muted">No judge yet</span>') + '</td>' +
            '<td><button class="btn sm ghost" data-newcode="' + esc(p) + '">New code</button></td></tr>';
        }));
    } else if (A.tab === 'programs') {
      el.innerHTML = programStatusHtml(AB.programList(as, sc, D.programStatus || []), { gender: A.F.gender, program: A.resProg, cat: A.F.cat }, true);
    } else if (A.tab === 'results') {
      var rs = AB.computeResults(as, sc).filter(function (b) { return b.category === A.F.cat && (!A.resProg || b.program === A.resProg) && (!A.F.gender || b.gender === A.F.gender); });
      A._results = rs;
      el.innerHTML = rs.length ? rs.map(function (b) {
        return '<div class="row" style="margin:18px 0 8px;gap:10px"><h3 class="grow">' + esc(b.program) + ' · ' + esc(b.gender) + ' · ' + esc(b.group) + '</h3>' + doneBtn(b.program, b.gender, b.group) + '</div>' +
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
    var ac = pickCat(e, 'aCat'); if (ac) { A.F.cat = ac; A.F.program = ''; A.resProg = ''; paintAdmin(); return; }
    var t, sc = pickSec(e, 'eSec');
    if (sc == null) sc = pickSec(e, 'aSec');
    if (sc != null) { A.F.gender = sc; paintAdminList(); return; }
    if ((t = e.target.closest('[data-tab]'))) { A.tab = t.dataset.tab; A.q = ''; paintAdmin(); return; }
    if (e.target.closest('[data-refresh]')) { loadData(s).then(paintAdmin); return; }
    if (e.target.closest('[data-downloads]')) { openDownloads(true); return; }
    if (e.target.closest('[data-export]')) { exportTab(); return; }
    if (e.target.closest('[data-seed]')) { window.ABDemo.seed(); toast('Sample data loaded'); loadData(s).then(paintAdmin); return; }
    if (e.target.closest('[data-reset]')) {
      if (!confirm('Delete ALL demo data in this browser?')) return;
      window.ABDemo.reset(); sessions = {}; store.set('sessions', {}); D = null; toast('Demo data cleared'); route(); return;
    }
    if ((t = e.target.closest('[data-newcode]'))) {
      var prog = t.dataset.newcode;
      if (!confirm('Give "' + prog + '" a new judge code?\nThe old code stops working for new logins.')) return;
      busy(t, true, '');
      api('setJudgeCode', { token: s.token, program: prog }).then(function (r) {
        busy(t, false);
        if (!r.ok) { toast(r.error, true); return; }
        toast(prog + ' · new code ' + r.code); loadData(s).then(paintAdminList);
      });
      return;
    }
    if ((t = e.target.closest('[data-done]'))) { setProgramStatus(t, s, t.dataset.prog, t.dataset.section, t.dataset.done, t.dataset.to); return; }
    if ((t = e.target.closest('[data-toggle]'))) { toggleCheckin(t, s); return; }
    if ((t = e.target.closest('[data-edit]'))) { editReg(t.dataset.edit, s); return; }
    if ((t = e.target.closest('[data-del]'))) {
      var r = D.registrations.filter(function (x) { return String(x.chest) === t.dataset.del; })[0];
      if (!confirm('Delete chest ' + r.chest + ' — ' + r.name + '?\nThis removes the registration, all program entries and all marks. It cannot be undone.')) return;
      api('deleteReg', { token: s.token, chest: r.chest }).then(function (x) { if (!x.ok) return toast(x.error, true); toast('Deleted chest ' + r.chest); loadData(s).then(paintAdmin); });
      return;
    }
    if ((t = e.target.closest('[data-editscore]'))) {
      var ms = A._scoreList[Number(t.dataset.editscore)];
      var nv = prompt('New score for chest ' + ms.chest + ' in ' + ms.program + ' (judge: ' + ms.judge + ')\nEnter 0–100:', ms.score);
      if (nv == null || nv === '' || String(nv) === String(ms.score)) return;
      var num = Number(nv);
      if (isNaN(num) || num < 0 || num > 100) { toast('Score must be between 0 and 100.', true); return; }
      busy(t, true, '');
      api('score', { token: s.token, program: ms.program, judgeName: ms.judge, entries: [{ chest: ms.chest, score: num, remarks: ms.remarks, team: ms.team }] }).then(function (x) {
        busy(t, false);
        if (!x.ok) return toast(x.error, true);
        toast('Chest ' + ms.chest + ' · ' + ms.program + ' → ' + num); loadData(s).then(paintAdmin);
      });
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
      '<div id="editItems"></div>' +
      '<div class="field"><label class="f">Volunteer notes</label><textarea class="in" name="notes" rows="3">' + esc(r.notes) + '</textarea></div>' +
      '<p class="hint">Gender can\'t be changed. Removing an item also removes its marks.</p><div id="editErr"></div>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save changes</button></div></form>';
    document.body.appendChild(m);
    var pick = { sports: AB.splitItems(r.sports), arts: AB.splitItems(r.arts) };
    var paintItems = function () {
      var cls = $('[name=cls]', m).value, raw = AB.isRawdha(cls), al = AB.artsFor(r.gender, cls);
      if (r.gender !== 'Boys' || raw) pick.sports = [];
      pick.arts = pick.arts.filter(function (x) { return al.indexOf(x) >= 0; });
      var box = function (cat, list, title) {
        var sel = pick[cat], full = sel.length >= AB.MAX_PER_CATEGORY;
        return '<div class="cathead" style="margin:12px 0 8px"><h3 style="font-size:14px">' + title + '</h3><span class="counter' + (full ? ' full' : '') + '">' + sel.length + ' / 3</span></div><div class="picks">' +
          list.map(function (it) { var on = sel.indexOf(it) >= 0, off = !on && full;
            return '<label class="pick' + (on ? ' on' : '') + (off ? ' off' : '') + '" style="min-height:42px;padding:8px 10px;font-size:13px"><input type="checkbox" data-ecat="' + cat + '" data-eitem="' + esc(it) + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '>' + esc(it) + '</label>';
          }).join('') + '</div>';
      };
      $('#editItems', m).innerHTML = (r.gender === 'Boys' && !raw ? box('sports', AB.SPORTS, 'Sports items') : '') + box('arts', al, 'Arts items');
    };
    paintItems();
    m.onchange = function (e) {
      if (e.target.name === 'cls') { paintItems(); return; }
      var c = e.target.dataset.ecat; if (!c) return;
      if (e.target.checked && pick[c].length < AB.MAX_PER_CATEGORY && pick[c].indexOf(e.target.dataset.eitem) < 0) pick[c].push(e.target.dataset.eitem);
      if (!e.target.checked) pick[c] = pick[c].filter(function (x) { return x !== e.target.dataset.eitem; });
      paintItems();
    };
    m.onclick = function (e) { if (e.target === m || e.target.closest('[data-close]')) m.remove(); };
    $('#editForm').onsubmit = function (e) {
      e.preventDefault();
      var patch = {}; $$('[name]', m).forEach(function (el) { patch[el.name] = el.value; });
      patch.sports = pick.sports; patch.arts = pick.arts;
      var before = AB.splitItems(r.sports).concat(AB.splitItems(r.arts)), after = pick.sports.concat(pick.arts);
      var gone = before.filter(function (x) { return after.indexOf(x) < 0; });
      if (gone.length && !confirm('Remove ' + gone.join(', ') + ' from chest ' + r.chest + '?\nAny marks for these items will also be removed.')) return;
      var btn = $('button[type=submit]', m); busy(btn, true);
      api('updateReg', { token: s.token, chest: r.chest, patch: patch }).then(function (x) {
        busy(btn, false);
        if (!x.ok) { $('#editErr').innerHTML = '<div class="notice bad" style="margin-bottom:12px">' + esc(x.error) + '</div>'; return; }
        m.remove(); toast('Saved chest ' + r.chest); loadData(s).then(function () { if (current() === 'admin') paintAdmin(); else paintTeacher(); });
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

  var VIEWS = { home: viewHome, register: viewRegister, scoreboard: viewScoreboard, teacher: viewTeacher, volunteer: viewVolunteer, judge: viewJudge, admin: viewAdmin };
  route();
})();
