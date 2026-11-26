/* 「もしも地図」PR投稿フォーム v10（2026-11-26。v10 でメールアドレスの確認欄と、送信前の確認画面を追加。v9 で「PRの目的」「写真素材の有無」を必須に。v3 は上の3段の進み具合〈ご連絡先・PRの内容・ご確認事項〉を表示）
 * 書きかえるのは CONFIG の3つだけ（設定手順書を参照）。XXXX のままの所は読み込まない／送らない（試しの動き）。
 * 計測に送るのは「どの項目か」だけ。入力された文字は GA4 にも Clarity にも送らない。
 *
 * GA4 のイベント（すべてに src＝流入元 がつく）
 *   form_view             ページを開いた
 *   field_start           項目に初めてさわった       field_name, field_index, step_name（例 "01_company"）
 *   field_complete        項目を書き終えた（正しい値）  同上
 *   field_error           必須の未記入・形式ちがい    同上 ＋ error_type（required / format）
 *   form_review           入力に問題がなく、確認画面を出した  filled_optional
 *   form_review_back      確認画面から「修正する」で戻った
 *   form_submit           確認画面の「送信する」で送信を始めた     filled_optional（任意3項目〈URL・投稿時期・注意点〉のうち書いた数）
 *   form_submit_success   送信が届いた
 *   form_submit_fail      送信に失敗した              reason
 * 動きの確認：localhost や ?debug=1 で開くと、コンソールに [pr-form] の行が順に出る
 */
(function () {
  'use strict';

  var CONFIG = {
    GA4_ID: 'G-WR25XBTGB0',                                           // GA4 の測定 ID
    CLARITY_ID: 'zjh8rxzf5d',                                       // Microsoft Clarity のプロジェクト ID
    ENDPOINT: 'https://script.google.com/macros/s/AKfycbxvvtF0Gna6umeR4Oi5qoOpquk05ofl3DECXGDle3vMn1Qjs7_qKZGobnHUJJMc3KJkJg/exec', // Apps Script のウェブアプリの URL
    FALLBACK_FORM: 'https://forms.gle/fiJJjuhbwCjKRzpf7'            // 送れなかったときの案内先（いまの Google フォーム）
  };

  var isSet = function (v) { return v && !/X{6,}/.test(v); };
  var params = new URLSearchParams(location.search);
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  var DEBUG = params.get('debug') === '1' || LOCAL;

  // ------------------------------------------------------------ 流入元（?src=instagram など。なければ utm_source、それもなければ direct）
  var SRC = (function () {
    var raw = params.get('src') || params.get('utm_source') || '';
    raw = raw.toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 30);
    try {
      if (raw) sessionStorage.setItem('pr_src', raw);
      else raw = sessionStorage.getItem('pr_src') || '';
    } catch (e) { /* 保存できない環境でも動く */ }
    return raw || 'direct';
  })();

  // ------------------------------------------------------------ 項目（順番＝目標到達プロセスの順）
  var FIELDS = ['company', 'name', 'email', 'email_confirm', 'target', 'url', 'purpose', 'timing', 'caution', 'photos', 'confirm'];
  var REQUIRED = { company: 1, name: 1, email: 1, email_confirm: 1, target: 1, purpose: 1, photos: 1, confirm: 1 };
  var OPTIONAL = ['url', 'timing', 'caution'];
  // 項目の番号（GA4 の step_name）。v10 で足したメールの確認欄は 03b にして、ほかの番号は変えない
  var NO = { company: '01', name: '02', email: '03', email_confirm: '03b', target: '04', url: '05', purpose: '06', timing: '07', caution: '08', photos: '09', confirm: '10' };
  var idx = function (f) { return parseInt(NO[f], 10); };
  var stepName = function (f) { return NO[f] + '_' + f; };
  // 確認画面に出す名前（メールの確認欄は出さない）
  var LABEL = { company: '貴社名・団体名・店舗名', name: 'ご担当者名', email: 'メールアドレス', target: 'PRしたい対象', url: '公式サイト・SNS の URL',
    purpose: 'PRの目的', timing: 'ご希望の投稿時期', caution: '表現上の注意点、避けたい内容', photos: '写真素材の有無', confirm: 'ご確認事項' };

  // ------------------------------------------------------------ GA4・Clarity の読み込み（ID が入っているときだけ）
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  var gaOn = isSet(CONFIG.GA4_ID);
  if (gaOn) {
    var s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.GA4_ID);
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', CONFIG.GA4_ID, { src: SRC, debug_mode: DEBUG || undefined });
    gtag('set', 'user_properties', { first_src: SRC });
  }

  // Clarity：入力欄の中身は伏せる（Clarity 側の設定に関係なく、この印で必ず伏せられる）
  Array.prototype.forEach.call(document.querySelectorAll('input, textarea'), function (el) { el.setAttribute('data-clarity-mask', 'true'); });
  var clarityOn = isSet(CONFIG.CLARITY_ID);
  if (clarityOn) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CONFIG.CLARITY_ID);
    window.clarity('set', 'src', SRC);
  }

  // ------------------------------------------------------------ イベントを送る（＋確認用のログ）
  var seq = 0;
  function track(name, p) {
    p = p || {};
    p.src = SRC;
    seq += 1;
    if (DEBUG) console.log('[pr-form] ' + seq + ' ' + name + ' ' + JSON.stringify(p));
    if (gaOn) gtag('event', name, p);
    if (clarityOn) {
      // 録画を「どこまで進んだか」で絞りこめるように、Clarity にも目印を残す
      if (name === 'field_start') window.clarity('set', 'last_field', p.step_name);
      if (/^form_/.test(name)) window.clarity('event', name);
      if (name === 'field_error') window.clarity('event', 'field_error_' + p.field_name);
    }
  }
  function fp(f, extra) {
    var o = { field_name: f, field_index: idx(f), step_name: stepName(f) };
    for (var k in extra) o[k] = extra[k];
    return o;
  }

  // ------------------------------------------------------------ 入力の確かめ
  var form = document.getElementById('pr-form');
  var EMAIL_RE = /^[^\s@＠]+@[^\s@＠]+\.[^\s@＠.]+$/;
  function value(f) {
    if (f === 'purpose' || f === 'photos') { var r = form.querySelector('input[name="' + f + '"]:checked'); return r ? r.value : ''; }
    if (f === 'confirm') return Array.prototype.map.call(form.querySelectorAll('input[name="confirm"]:checked'), function (c) { return c.value; });
    return (form.elements[f].value || '').trim();
  }
  function check(f) {   // '' なら問題なし。そうでなければ error_type
    var v = value(f);
    if (f === 'confirm') return v.length === 4 ? '' : 'required';
    if (REQUIRED[f] && !v) return 'required';
    if (f === 'email' && v && !EMAIL_RE.test(v)) return 'format';
    if (f === 'email_confirm' && v && value('email') && v.toLowerCase() !== value('email').toLowerCase()) return 'mismatch';
    return '';
  }
  function filled(f) { var v = value(f); return f === 'confirm' ? v.length === 4 : !!v; }
  var MSG = {
    required: 'この項目は必須です。',
    choose: 'いずれか1つをお選びください。',
    format: 'メールアドレスの形式をご確認ください。',
    mismatch: 'メールアドレスが一致しません。もう一度ご確認ください。',
    confirm: '4点すべてにチェックをお願いします。'
  };
  function showErr(f, type) {
    var q = form.querySelector('[data-field="' + f + '"]'), e = document.getElementById('e-' + f);
    q.classList.toggle('has-err', !!type);
    e.textContent = type ? (f === 'confirm' ? MSG.confirm : (f === 'purpose' || f === 'photos') ? MSG.choose : MSG[type]) : '';
    var ctl = form.querySelector('#f-' + f);
    if (ctl) { if (type) ctl.setAttribute('aria-invalid', 'true'); else ctl.removeAttribute('aria-invalid'); }
  }

  // ------------------------------------------------------------ 項目ごとの始め・終わり
  var started = {}, completed = {}, errShown = {};
  function fieldOf(el) { var q = el.closest && el.closest('[data-field]'); return q ? q.getAttribute('data-field') : null; }
  function start(f) { if (!started[f]) { started[f] = 1; track('field_start', fp(f)); } }
  function complete(f) {
    if (completed[f] || !filled(f) || check(f)) return;
    completed[f] = 1; track('field_complete', fp(f));
  }

  // 上の3段の進み具合：段の必須項目がそろうと「済み」、そろっていない最初の段が「いま」
  var STEPS = { 1: ['company', 'name', 'email', 'email_confirm'], 2: ['target', 'purpose', 'photos'], 3: ['confirm'] };
  var stepEls = document.querySelectorAll('#steps li');
  function progress() {
    var nowSet = false;
    Array.prototype.forEach.call(stepEls, function (li) {
      var n = li.getAttribute('data-step');
      var ok = STEPS[n].every(function (f) { return filled(f) && !check(f); });
      li.classList.toggle('done', ok);
      li.classList.toggle('now', !ok && !nowSet);
      if (!ok) nowSet = true;
      li.querySelector('a').setAttribute('aria-current', li.classList.contains('now') ? 'step' : 'false');
    });
  }
  form.addEventListener('input', progress);
  form.addEventListener('change', progress);

  form.addEventListener('focusin', function (ev) { var f = fieldOf(ev.target); if (f) start(f); });
  form.addEventListener('focusout', function (ev) {
    var f = fieldOf(ev.target); if (!f || f === 'purpose' || f === 'photos' || f === 'confirm') return;
    complete(f);
    // メールの形式ちがいは、欄をはなれた時点で知らせる
    if ((f === 'email' || f === 'email_confirm') && value(f)) {
      var t = check(f); showErr(f, t);
      if (t && !errShown[f + '_blur']) { errShown[f + '_blur'] = 1; track('field_error', fp(f, { error_type: t, at: 'blur' })); }
    }
    // メールを直したら、確認欄の「一致しません」も見直す
    if (f === 'email' && value('email_confirm')) showErr('email_confirm', check('email_confirm'));
  });
  form.addEventListener('input', function (ev) {
    var f = fieldOf(ev.target); if (!f) return;
    start(f);
    if (form.querySelector('[data-field="' + f + '"]').classList.contains('has-err') && !check(f)) showErr(f, '');
  });
  form.addEventListener('change', function (ev) {
    var f = fieldOf(ev.target); if (!f) return;
    start(f);
    if (f === 'purpose' || f === 'photos' || f === 'confirm') { complete(f); if (!check(f)) showErr(f, ''); }
  });

  // ------------------------------------------------------------ 確認画面 → 送信
  var intro = document.getElementById('intro'), review = document.getElementById('review'), list = document.getElementById('review-list');
  var sendBtn = document.getElementById('send'), sendLabel = document.getElementById('send-label'), eSend = document.getElementById('e-send');
  var sending = false;

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();

    var first = null;
    FIELDS.forEach(function (f) {
      var t = check(f); showErr(f, t);
      if (t) { track('field_error', fp(f, { error_type: t, at: 'submit' })); if (!first) first = f; }
    });
    if (first) {
      var q = form.querySelector('[data-field="' + first + '"]');
      q.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var ctl = q.querySelector('input, textarea'); if (ctl) setTimeout(function () { ctl.focus({ preventScroll: true }); }, 350);
      return;
    }

    // 書き終えた合図が出ていない項目（自動入力など）を、ここでそろえる
    FIELDS.forEach(function (f) { if (filled(f)) { start(f); complete(f); } });
    showReview();
    track('form_review', { filled_optional: OPTIONAL.filter(filled).length });
  });

  function showReview() {
    list.textContent = '';
    FIELDS.forEach(function (f) {
      if (!LABEL[f]) return;
      var v = value(f);
      var text = f === 'confirm' ? '4点すべて確認済み' : (v || '');
      var dt = document.createElement('dt'); dt.textContent = LABEL[f];
      var dd = document.createElement('dd');
      if (text) dd.textContent = text; else { dd.textContent = '（未記入）'; dd.className = 'none'; }
      list.appendChild(dt); list.appendChild(dd);
    });
    eSend.textContent = '';
    intro.hidden = true; form.hidden = true; review.hidden = false;
    window.scrollTo(0, 0); review.focus({ preventScroll: true });
  }

  document.getElementById('back').addEventListener('click', function () {
    if (sending) return;
    review.hidden = true; intro.hidden = false; form.hidden = false;
    track('form_review_back', {});
    document.getElementById('s1').scrollIntoView({ block: 'start' });
  });

  sendBtn.addEventListener('click', function () {
    if (sending) return;
    eSend.textContent = '';
    track('form_submit', { filled_optional: OPTIONAL.filter(filled).length });

    var data = {};
    FIELDS.forEach(function (f) {
      if (f === 'email_confirm') return;           // 確認欄は送らない
      var v = value(f); data[f] = f === 'confirm' ? (v.length === 4 ? '4点すべて確認' : v.join(' / ')) : v;
    });
    data.src = SRC;
    data.website = form.elements.website.value;   // いたずらよけの欄（ふつうは空）
    data.page = location.origin + location.pathname;

    if (data.website) { done(); return; }          // 機械の送信は、送ったふりだけ

    sending = true; sendBtn.disabled = true; sendLabel.textContent = '送信しています…';
    send(data).then(function () {
      track('form_submit_success', {});
      done();
    }).catch(function (err) {
      var reason = (err && err.message) || 'unknown';
      track('form_submit_fail', { reason: reason.slice(0, 60) });
      eSend.innerHTML = '送信できませんでした。通信状況をご確認のうえ、もう一度お試しください。<br>解決しない場合は、<a href="' + CONFIG.FALLBACK_FORM + '" target="_blank" rel="noopener">こちらのフォーム</a>からお申し込みください。';
    }).then(function () {
      sending = false; sendBtn.disabled = false; sendLabel.textContent = 'この内容で送信する';
    });
  });

  function send(data) {
    if (!isSet(CONFIG.ENDPOINT)) {
      // 送信先が未設定：パソコンの中の試しのときだけ、外には何も送らず届いたことにする。
      // 公開したページで未設定のときは、届いたふりをせず失敗として Google フォームを案内する（申し込みが消えるのを防ぐ）
      if (!LOCAL) { console.error('[pr-form] 送信先（CONFIG.ENDPOINT）が未設定です'); return Promise.reject(new Error('no_endpoint')); }
      if (DEBUG) console.log('[pr-form] (送信先が未設定のため、外部には送っていません。項目: ' + Object.keys(data).join(',') + ')');
      return new Promise(function (ok) { setTimeout(ok, 500); });
    }
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    // Content-Type を付けない（text/plain になり、事前確認の通信なしで Apps Script に届く）
    return fetch(CONFIG.ENDPOINT, { method: 'POST', body: JSON.stringify(data), signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); if (!j || !j.ok) throw new Error((j && j.error) || 'bad_response'); })
      .catch(function (e) { clearTimeout(timer); throw (e && e.name === 'AbortError') ? new Error('timeout') : e; });
  }

  function done() {
    form.hidden = true; review.hidden = true;
    Array.prototype.forEach.call(stepEls, function (li) { li.classList.remove('now'); li.classList.add('done'); });
    document.getElementById('intro').hidden = true;
    var d = document.getElementById('done'); d.hidden = false;
    window.scrollTo(0, 0); d.focus();
  }

  track('form_view', {});
})();
