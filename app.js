/* CommitDesk — front-end only. All state lives in localStorage (with in-memory fallback). */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Storage (localStorage wrapped in try/catch, in-memory fallback)
  // ---------------------------------------------------------------------------
  var KEYS = { tasks: 'commitdesk.tasks.v1', chat: 'commitdesk.chat.v1', settings: 'commitdesk.settings.v1' };
  var memoryStore = {};
  var storageOk = (function () {
    try {
      var t = '__commitdesk_test__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return true;
    } catch (e) { return false; }
  })();

  function load(key, fallback) {
    var raw = null;
    try { raw = storageOk ? window.localStorage.getItem(key) : (key in memoryStore ? memoryStore[key] : null); }
    catch (e) { raw = key in memoryStore ? memoryStore[key] : null; }
    if (raw === null || raw === undefined) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function save(key, value) {
    var raw;
    try { raw = JSON.stringify(value); } catch (e) { return; }
    memoryStore[key] = raw;
    if (!storageOk) return;
    try { window.localStorage.setItem(key, raw); } catch (e) { storageOk = false; }
  }
  function remove(key) {
    delete memoryStore[key];
    try { if (storageOk) window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Date helpers (local time, YYYY-MM-DD)
  // ---------------------------------------------------------------------------
  var DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function todayStr() { return fmt(startOfToday()); }
  function addDays(n) { var d = startOfToday(); d.setDate(d.getDate() + n); return fmt(d); }
  function parseYMD(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) return null;
    return d;
  }
  function validDate(s) { return parseYMD(s) ? s : ''; }
  function daysFromToday(s) {
    var d = parseYMD(s);
    if (!d) return null;
    return Math.round((d - startOfToday()) / 86400000);
  }
  function prettyDate(s) {
    var d = parseYMD(s);
    if (!d) return 'No date';
    var diff = daysFromToday(s);
    var base = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return base;
  }
  function daysUntilWeekday(target, allowToday) {
    var dow = startOfToday().getDay();
    var d = (target - dow + 7) % 7;
    if (d === 0 && !allowToday) d = 7;
    return d;
  }

  var WD = '(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday)';
  var MON = '(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';
  var PRE = '(?:(?:by|on|before|due|until|till|for|no later than|latest by)\\s+)?';
  var NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, couple: 2 };

  function weekdayIndex(w) {
    w = w.toLowerCase();
    for (var i = 0; i < 7; i++) if (DAY_NAMES[i].indexOf(w.slice(0, 3)) === 0) return i;
    return -1;
  }
  function monthIndex(m) { return MONTHS.indexOf(m.toLowerCase().slice(0, 3)); }
  function ymdFromParts(y, m, d) {
    var dt = new Date(y, m, d);
    if (dt.getMonth() !== m || dt.getDate() !== d) return '';
    return fmt(dt);
  }
  function guessYear(m, d) {
    var y = startOfToday().getFullYear();
    var s = ymdFromParts(y, m, d);
    if (s && daysFromToday(s) < -180) s = ymdFromParts(y + 1, m, d);
    return s;
  }

  // Returns { date: 'YYYY-MM-DD', match: 'matched text' } or null.
  var DATE_RULES = [
    { re: new RegExp(PRE + '\\b(\\d{4}-\\d{2}-\\d{2})\\b', 'i'), fn: function (m) { return validDate(m[1]); } },
    { re: new RegExp(PRE + '\\b(?:end of (?:the )?day|eod|today|tonight|this evening)\\b', 'i'), fn: function () { return addDays(0); } },
    { re: new RegExp(PRE + '\\b(?:the )?day after tomorrow\\b', 'i'), fn: function () { return addDays(2); } },
    { re: new RegExp(PRE + '\\b(?:tomorrow|tmrw|tmr)\\b', 'i'), fn: function () { return addDays(1); } },
    { re: new RegExp(PRE + '\\b(?:end of (?:the |this )?week|eow|this week)\\b', 'i'), fn: function () { return addDays(daysUntilWeekday(5, true)); } },
    { re: new RegExp(PRE + '\\b(?:end of next week)\\b', 'i'), fn: function () { return addDays(daysUntilWeekday(5, true) + 7); } },
    { re: new RegExp(PRE + '\\bnext week\\b', 'i'), fn: function () { return addDays(daysUntilWeekday(1, false)); } },
    { re: new RegExp(PRE + '\\b(?:end of (?:the )?month|eom)\\b', 'i'), fn: function () { var d = startOfToday(); return fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0)); } },
    { re: new RegExp(PRE + '\\bin (\\d+|a|an|one|two|three|four|five|six|seven|ten|a couple of|couple of) (day|days|week|weeks)\\b', 'i'), fn: function (m) {
        var key = m[1].toLowerCase().replace(' of', '').replace('a couple', 'couple');
        var n = /^\d+$/.test(key) ? parseInt(key, 10) : (NUMWORDS[key] || 1);
        return addDays(/week/i.test(m[2]) ? n * 7 : n);
      } },
    { re: new RegExp(PRE + '\\bnext ' + WD + '\\b', 'i'), fn: function (m) { var i = weekdayIndex(m[1]); return i < 0 ? '' : addDays(daysUntilWeekday(i, false)); } },
    { re: new RegExp(PRE + '\\b(?:this |coming |this coming )?' + WD + '\\b', 'i'), fn: function (m) { var i = weekdayIndex(m[1]); return i < 0 ? '' : addDays(daysUntilWeekday(i, true)); } },
    { re: new RegExp(PRE + '\\b' + MON + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i'), fn: function (m) {
        var mi = monthIndex(m[1]), d = parseInt(m[2], 10);
        return m[3] ? ymdFromParts(parseInt(m[3], 10), mi, d) : guessYear(mi, d);
      } },
    { re: new RegExp(PRE + '\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON + '(?:,?\\s+(\\d{4}))?\\b', 'i'), fn: function (m) {
        var mi = monthIndex(m[2]), d = parseInt(m[1], 10);
        return m[3] ? ymdFromParts(parseInt(m[3], 10), mi, d) : guessYear(mi, d);
      } },
    { re: new RegExp(PRE + '\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b', 'i'), fn: function (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10), day, mon;
        if (b > 12) { mon = a; day = b; } else { day = a; mon = b; } // default DD/MM
        if (m[3]) { var y = parseInt(m[3], 10); if (y < 100) y += 2000; return ymdFromParts(y, mon - 1, day); }
        return guessYear(mon - 1, day);
      } }
  ];

  function parseDateFrom(text) {
    if (!text) return null;
    for (var i = 0; i < DATE_RULES.length; i++) {
      var m = text.match(DATE_RULES[i].re);
      if (m) {
        var date = DATE_RULES[i].fn(m);
        if (date) return { date: date, match: m[0] };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function uid() { return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function oneOf(v, list, dflt) {
    if (typeof v !== 'string') return dflt;
    var lv = v.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === lv) return list[i];
    return dflt;
  }
  var STATUSES = ['To Do', 'In Progress', 'Done'];
  var PRIORITIES = ['High', 'Medium', 'Low'];
  var EFFORTS = ['Small', 'Medium', 'Large'];
  var PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

  function normStatus(v) {
    var s = String(v || '').toLowerCase().trim();
    if (/^(done|complete|completed|finished|closed|resolved)$/.test(s)) return 'Done';
    if (/^(in progress|in-progress|started|doing|wip|ongoing)$/.test(s)) return 'In Progress';
    if (/^(to do|todo|to-do|open|not started|backlog|reopen|reopened)$/.test(s)) return 'To Do';
    return null;
  }

  var STOP = ('the a an to for of on in at with and or my our your this that it is be by me i we you please task ticket ' +
              'item thing as up from').split(' ');
  function tokens(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9#\- ]+/g, ' ').split(/[\s\-]+/).filter(function (w) {
      return w && STOP.indexOf(w) < 0;
    }).map(function (w) { return w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w; });
  }
  function similarity(a, b) {
    var ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {}, inter = 0, union = {};
    tb.forEach(function (w) { setB[w] = 1; union[w] = 1; });
    var seen = {};
    ta.forEach(function (w) { union[w] = 1; if (setB[w] && !seen[w]) { inter++; seen[w] = 1; } });
    var jaccard = inter / Object.keys(union).length;
    var containment = inter / Math.min(Object.keys(seen).length + (ta.length - inter), tb.length);
    return Math.max(jaccard, Math.min(1, containment) * 0.9);
  }

  // ---------------------------------------------------------------------------
  // Seed data (relative to today)
  // ---------------------------------------------------------------------------
  function seedTasks() {
    var now = Date.now();
    function created(hoursAgo) { return new Date(now - hoursAgo * 3600000).toISOString(); }
    var raw = [
      ['PAY-482: Fix duplicate charge on UPI retry', 'Customers are charged twice when a UPI collect request times out and the app retries. Add a guard on the retry path and backfill refunds for affected orders.', -1, 'Ananya Rao', 'High', 'Medium', 'In Progress', 'Jira', 'Seeing ~40 duplicate debits a day since the retry change shipped — need this fixed before the weekend.', 120],
      ['Send revised Q4 hiring plan to Priya', 'Update headcount numbers after the budget cut and share the revised Q4 hiring plan with Priya before the leadership sync.', -2, 'Priya Menon', 'High', 'Small', 'To Do', 'Meeting', 'Priya: can you send me the revised Q4 hiring plan before the leadership sync?', 96],
      ['Finalize API spec for partner onboarding', 'Lock the request/response schema for the partner onboarding API so the partner team can start integration.', 0, 'Rahul Verma', 'High', 'Medium', 'In Progress', 'Meeting', 'Rahul asked us to finalize the partner onboarding API spec by today so they can start building.', 72],
      ['Prepare slides for Monday ops review', 'Put together a 5-slide summary of payment success rates and open incidents for the ops review.', 0, 'Neha Kapoor', 'Medium', 'Small', 'To Do', 'Meeting', 'Neha wants the ops review slides ready by end of day so she can go through them over the weekend.', 30],
      ['PAY-505: Review PR for settlement batch retries', 'Review the pull request that adds exponential backoff to the nightly settlement batch job.', 3, 'Karthik Iyer', 'Medium', 'Small', 'To Do', 'Jira', 'PR is up for the settlement batch retry logic — needs one more approver before merge.', 20],
      ['Send revised pricing email to Acme vendor', 'Email the Acme vendor contact the revised per-transaction pricing with the volume discount tiers agreed in the call.', 4, 'Arjun Shah', 'Medium', 'Small', 'To Do', 'Meeting', 'Arjun: can you send the revised pricing email to the Acme vendor before their procurement review?', 26],
      ['Draft incident postmortem for checkout outage', 'Write up the timeline, root cause and follow-up actions for last week\'s 38-minute checkout outage.', 5, 'Vikram Desai', 'Medium', 'Medium', 'To Do', 'Meeting', 'Vikram asked me to draft the postmortem for the checkout outage by Wednesday.', 50],
      ['PAY-511: Update webhook retry docs for merchants', 'Document the new webhook retry schedule and signature verification steps in the merchant developer docs.', 6, 'Sneha Pillai', 'Low', 'Small', 'To Do', 'Jira', 'Merchants keep asking support how often failed webhooks are retried.', 44],
      ['PAY-476: Migrate fraud rules to the new rules engine', 'Port the 23 active fraud rules from the legacy service to the new rules engine and run both in shadow mode for a week.', 10, 'Ananya Rao', 'Medium', 'Large', 'To Do', 'Jira', 'Legacy fraud service is being decommissioned at the end of the quarter.', 140],
      ['PAY-469: Patch currency rounding in invoice export', 'Fix half-paise rounding errors in the CSV invoice export used by finance.', 1, 'Sneha Pillai', 'High', 'Small', 'Done', 'Jira', 'Finance flagged totals off by ₹0.01 on multi-currency invoices.', 160],
      ['Share sprint retro notes with the team', 'Clean up the retro board and post the notes with owners for each action item in the team channel.', 2, 'Me', 'Low', 'Small', 'Done', 'Meeting', 'I\'ll share the retro notes with everyone after the call.', 10]
    ];
    return raw.map(function (r, i) {
      return {
        id: 'seed_' + (i + 1), title: r[0], description: r[1], dueDate: addDays(r[2]), requester: r[3],
        priority: r[4], effort: r[5], status: r[6], source: r[7], sourceQuote: r[8], createdAt: created(r[9])
      };
    });
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  function sanitizeTask(t) {
    if (!t || typeof t !== 'object') return null;
    var title = clip(t.title, 140);
    if (!title) return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id : uid(),
      title: title,
      description: clip(t.description, 400),
      dueDate: validDate(t.dueDate),
      requester: clip(t.requester, 60) || 'Me',
      priority: oneOf(t.priority, PRIORITIES, 'Medium'),
      effort: oneOf(t.effort, EFFORTS, 'Medium'),
      status: normStatus(t.status) || 'To Do',
      source: oneOf(t.source, ['Jira', 'Meeting'], 'Meeting'),
      sourceQuote: clip(t.sourceQuote, 400),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString()
    };
  }

  var storedTasks = load(KEYS.tasks, null);
  var tasks;
  if (!Array.isArray(storedTasks)) { tasks = seedTasks(); save(KEYS.tasks, tasks); }
  else tasks = storedTasks.map(sanitizeTask).filter(Boolean);

  var settings = load(KEYS.settings, {}) || {};
  if (typeof settings !== 'object') settings = {};
  var chat = load(KEYS.chat, []);
  if (!Array.isArray(chat)) chat = [];
  var pending = null; // follow-up question state: { msgId, field, idxs }
  var flashIds = {};
  var busy = false;

  function persistTasks() { save(KEYS.tasks, tasks); }
  function persistChat() {
    if (chat.length > 120) chat = chat.slice(chat.length - 120);
    save(KEYS.chat, chat);
  }
  function persistSettings() { save(KEYS.settings, settings); }
  function hasKey() { return typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0; }
  function modelName() { return (settings.model && String(settings.model).trim()) || 'gemini-2.0-flash'; }

  function isOverdue(t) { var d = daysFromToday(t.dueDate); return t.status !== 'Done' && d !== null && d < 0; }
  function isDueToday(t) { return t.status !== 'Done' && daysFromToday(t.dueDate) === 0; }
  function findTask(id) { for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i]; return null; }

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var chatLog = $('chatLog'), chatInput = $('chatInput'), chatForm = $('chatForm'), sendBtn = $('sendBtn');
  var board = $('board'), toastEl = $('toast');

  // ---------------------------------------------------------------------------
  // Board rendering
  // ---------------------------------------------------------------------------
  function sortTasks(list) {
    return list.slice().sort(function (a, b) {
      var oa = isOverdue(a) ? 0 : 1, ob = isOverdue(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      var da = a.dueDate || '9999-12-31', db = b.dueDate || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
  }

  function taskCardHTML(t) {
    var overdue = isOverdue(t), today = isDueToday(t);
    var cls = 'task' + (overdue ? ' overdue' : '') + (today ? ' today' : '') + (t.status === 'Done' ? ' done' : '') + (flashIds[t.id] ? ' flash' : '');
    var statusOpts = STATUSES.map(function (s) { return '<option' + (s === t.status ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    return '<article class="' + cls + '" draggable="true" data-id="' + esc(t.id) + '">' +
      '<div class="task-top"><div class="task-title">' + esc(t.title) + '</div>' +
      (overdue ? '<span class="badge overdue">Overdue</span>' : today ? '<span class="badge today">Due today</span>' : '') + '</div>' +
      (t.description ? '<p class="task-desc">' + esc(t.description) + '</p>' : '') +
      (t.sourceQuote ? '<p class="task-quote">“' + esc(t.sourceQuote) + '”</p>' : '') +
      '<div class="task-meta">' +
        '<span class="badge p-' + t.priority.toLowerCase() + '">' + esc(t.priority) + '</span>' +
        '<span class="badge effort">' + esc(t.effort) + ' effort</span>' +
        '<span class="badge src">' + esc(t.source) + '</span>' +
        '<span>· ' + esc(t.requester) + '</span>' +
        '<span>· 📅 ' + esc(prettyDate(t.dueDate)) + '</span>' +
      '</div>' +
      '<div class="task-actions">' +
        '<label class="sr-only" for="st_' + esc(t.id) + '">Status</label>' +
        '<select id="st_' + esc(t.id) + '" data-action="status" data-id="' + esc(t.id) + '">' + statusOpts + '</select>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="link-btn" data-action="jira" data-id="' + esc(t.id) + '">Copy as Jira</button>' +
        '<button type="button" class="link-btn del" data-action="delete" data-id="' + esc(t.id) + '" aria-label="Delete task ' + esc(t.title) + '">Delete</button>' +
      '</div></article>';
  }

  function renderBoard() {
    STATUSES.forEach(function (s) {
      var body = board.querySelector('[data-drop="' + s + '"]');
      var list = sortTasks(tasks.filter(function (t) { return t.status === s; }));
      body.innerHTML = list.length ? list.map(taskCardHTML).join('') : '<div class="empty">' + (s === 'Done' ? 'Nothing completed yet' : 'No tasks here') + '</div>';
      board.querySelector('[data-count="' + s + '"]').textContent = list.length;
    });
    $('statOpen').textContent = tasks.filter(function (t) { return t.status !== 'Done'; }).length;
    $('statToday').textContent = tasks.filter(isDueToday).length;
    $('statDone').textContent = tasks.filter(function (t) { return t.status === 'Done'; }).length;
    var mb = $('modeBadge');
    mb.textContent = hasKey() ? 'Gemini on' : 'Local parser';
    mb.className = 'mode-badge' + (hasKey() ? ' ai' : '');
  }

  function flash(ids) {
    ids.forEach(function (id) { flashIds[id] = true; });
    setTimeout(function () { ids.forEach(function (id) { delete flashIds[id]; }); }, 2300);
  }

  function setStatus(t, status) {
    if (!t || t.status === status) return;
    t.status = status;
    persistTasks(); flash([t.id]); renderBoard();
  }

  board.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute('data-action') === 'status') setStatus(findTask(el.getAttribute('data-id')), el.value);
  });
  board.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var t = findTask(el.getAttribute('data-id'));
    if (!t) return;
    var action = el.getAttribute('data-action');
    if (action === 'delete') {
      if (!window.confirm('Delete “' + t.title + '”?')) return;
      tasks = tasks.filter(function (x) { return x.id !== t.id; });
      persistTasks(); renderBoard(); toast('Task deleted');
    } else if (action === 'jira') {
      copyText(jiraText(t), 'Copied as Jira ticket');
    }
  });

  // Drag & drop
  var dragId = null;
  board.addEventListener('dragstart', function (e) {
    var card = e.target.closest && e.target.closest('.task');
    if (!card) return;
    dragId = card.getAttribute('data-id');
    card.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* ignore */ }
  });
  board.addEventListener('dragend', function (e) {
    var card = e.target.closest && e.target.closest('.task');
    if (card) card.classList.remove('dragging');
    board.querySelectorAll('.drag-over').forEach(function (n) { n.classList.remove('drag-over'); });
    dragId = null;
  });
  board.addEventListener('dragover', function (e) {
    var zone = e.target.closest && e.target.closest('[data-drop]');
    if (!zone || !dragId) return;
    e.preventDefault();
    board.querySelectorAll('.drag-over').forEach(function (n) { if (n !== zone) n.classList.remove('drag-over'); });
    zone.classList.add('drag-over');
  });
  board.addEventListener('drop', function (e) {
    var zone = e.target.closest && e.target.closest('[data-drop]');
    if (!zone || !dragId) return;
    e.preventDefault();
    zone.classList.remove('drag-over');
    setStatus(findTask(dragId), zone.getAttribute('data-drop'));
  });

  // ---------------------------------------------------------------------------
  // Clipboard, toast, Jira & standup text
  // ---------------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg); };
    var fail = function () { if (fallbackCopy(text)) done(); else toast('Copy failed — your browser blocked clipboard access'); };
    try {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    } catch (e) { fail(); }
  }
  function jiraText(t) {
    var keyMatch = t.title.match(/^([A-Z][A-Z0-9]+-\d+):\s*(.*)$/);
    var summary = keyMatch ? keyMatch[2] : t.title;
    return [
      'Summary: ' + summary,
      '',
      'Description:',
      t.description || summary,
      '',
      'Requested by: ' + t.requester,
      t.sourceQuote ? 'Source (' + t.source + '): "' + t.sourceQuote + '"' : 'Source: ' + t.source,
      keyMatch ? 'Related ticket: ' + keyMatch[1] : '',
      '',
      'Priority: ' + t.priority,
      'Due date: ' + (t.dueDate || 'Not set'),
      'Effort: ' + t.effort
    ].filter(function (l, i, arr) { return l !== '' || (arr[i - 1] !== '' && i > 0); }).join('\n').trim();
  }
  function standupText() {
    var today = todayStr();
    var done = tasks.filter(function (t) { return t.status === 'Done'; });
    var dueToday = sortTasks(tasks.filter(isDueToday));
    var overdue = sortTasks(tasks.filter(isOverdue));
    var inProg = tasks.filter(function (t) { return t.status === 'In Progress' && !isDueToday(t) && !isOverdue(t); });
    function line(t) { return '• ' + t.title + (t.requester && t.requester !== 'Me' ? ' (for ' + t.requester + ')' : ''); }
    var out = ['Standup — ' + today, '', '✅ Done:'];
    out = out.concat(done.length ? done.map(line) : ['• Nothing marked done yet']);
    out.push('', '📅 Due today:');
    out = out.concat(dueToday.length ? dueToday.map(function (t) { return line(t) + ' [' + t.status + ']'; }) : ['• Nothing due today']);
    out.push('', '⚠️ Overdue:');
    out = out.concat(overdue.length ? overdue.map(function (t) { return line(t) + ' — due ' + prettyDate(t.dueDate); }) : ['• Nothing overdue']);
    if (inProg.length) { out.push('', '🔧 Also in progress:'); out = out.concat(inProg.map(line)); }
    return out.join('\n');
  }
  $('standupBtn').addEventListener('click', function () {
    var text = standupText();
    copyText(text, 'Standup copied to clipboard');
    addMsg({ role: 'assistant', type: 'text', text: 'Here\'s your standup (also copied to your clipboard):\n\n' + text });
  });

  // ---------------------------------------------------------------------------
  // Chat rendering
  // ---------------------------------------------------------------------------
  function mid() { return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function addMsg(m) {
    m.id = m.id || mid();
    m.at = m.at || Date.now();
    chat.push(m);
    persistChat();
    chatLog.appendChild(renderMsg(m));
    scrollChat();
    return m;
  }
  function scrollChat() { chatLog.scrollTop = chatLog.scrollHeight; }
  function richText(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
  function renderMsg(m) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + m.role + (m.kind === 'error' ? ' error' : '') + (m.type === 'drafts' ? ' wide' : '');
    wrap.setAttribute('data-mid', m.id);
    if (m.type === 'drafts') { wrap.innerHTML = draftCardHTML(m); return wrap; }
    var html = '<div class="bubble">' + richText(m.text || '');
    if (m.type === 'list' && Array.isArray(m.items)) {
      html += m.items.length ? '<ul class="mini-list">' + m.items.map(function (it) {
        return '<li>' + esc(it.title) + '<div class="meta">' + esc(it.meta) + '</div></li>';
      }).join('') + '</ul>' : '';
    }
    html += '</div>';
    if (m.note) html += '<div class="note">' + richText(m.note) + '</div>';
    if (Array.isArray(m.chips) && m.chips.length && !m.chipsUsed) {
      html += '<div class="chips">' + m.chips.map(function (c) {
        return '<button type="button" class="chip" data-chip="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('') + '</div>';
    }
    wrap.innerHTML = html;
    return wrap;
  }
  function renderChat() {
    chatLog.innerHTML = '';
    chat.forEach(function (m) { chatLog.appendChild(renderMsg(m)); });
    scrollChat();
  }
  function rerenderMsg(m) {
    var old = chatLog.querySelector('[data-mid="' + m.id + '"]');
    if (old) old.replaceWith(renderMsg(m));
    persistChat();
  }
  function findMsg(id) { for (var i = 0; i < chat.length; i++) if (chat[i].id === id) return chat[i]; return null; }

  var typingEl = null;
  function showTyping(label) {
    hideTyping();
    typingEl = document.createElement('div');
    typingEl.className = 'msg assistant typing';
    typingEl.innerHTML = '<div class="bubble">' + esc(label) + '<span class="dots"></span></div>';
    chatLog.appendChild(typingEl); scrollChat();
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  // ---------------------------------------------------------------------------
  // Confirmation card (editable drafts)
  // ---------------------------------------------------------------------------
  function findDuplicate(d) {
    var best = null, bestScore = 0;
    tasks.forEach(function (t) {
      if (t.status === 'Done') return;
      var ra = (t.requester || 'Me').toLowerCase().trim(), rb = (d.requester || 'Me').toLowerCase().trim();
      var sameReq = ra === rb || ra.split(/\s+/)[0] === rb.split(/\s+/)[0];
      if (!sameReq) return;
      var s = similarity(d.title, t.title);
      if (s > bestScore) { bestScore = s; best = t; }
    });
    return bestScore >= 0.55 ? best : null;
  }
  function refreshDuplicates(m) {
    m.drafts.forEach(function (d) {
      var dup = findDuplicate(d);
      var prev = d.dupOf;
      d.dupOf = dup ? dup.id : null;
      if (!d.dupOf) { if (d.action === 'merge') d.action = 'new'; }
      else if (prev !== d.dupOf && d.action !== 'skip') d.action = 'merge';
    });
  }

  function opt(list, val) { return list.map(function (v) { return '<option' + (v === val ? ' selected' : '') + '>' + v + '</option>'; }).join(''); }

  function draftCardHTML(m) {
    var resolved = m.state !== 'open';
    var html = '<div class="confirm-card' + (resolved ? ' resolved' : '') + '">';
    html += '<div class="confirm-head"><strong>' + (resolved ? (m.state === 'added' ? '✓ ' : '✕ ') : '') +
      esc(m.drafts.length + ' task' + (m.drafts.length === 1 ? '' : 's') + ' found') + '</strong>' +
      '<span class="note">' + esc(m.engine === 'gemini' ? 'via Gemini' : 'via local parser') + '</span></div>';
    if (m.state === 'open') html += '<div class="note">Check the details — edit anything inline, then add them to your board.</div>';
    m.drafts.forEach(function (d, i) {
      var dis = resolved ? ' disabled' : '';
      var dup = d.dupOf ? findTask(d.dupOf) : null;
      html += '<div class="draft' + (dup ? ' is-dup' : '') + (d.action === 'skip' ? ' skipped' : '') + '" data-i="' + i + '">';
      if (!resolved) html += '<button type="button" class="icon-btn remove-draft" data-draft-remove="' + i + '" aria-label="Remove this task">✕</button>';
      html += '<label class="full">Title<input data-f="title" value="' + esc(d.title) + '"' + dis + '></label>';
      html += '<label class="full">Description<textarea data-f="description" rows="2"' + dis + '>' + esc(d.description) + '</textarea></label>';
      html += '<label>Due date<input type="date" data-f="dueDate" value="' + esc(d.dueDate) + '"' + (d.dueDate ? '' : ' class="missing"') + dis + '></label>';
      html += '<label>Requester<input data-f="requester" value="' + esc(d.requester) + '"' + (d.requester ? '' : ' class="missing" placeholder="Who asked?"') + dis + '></label>';
      html += '<label>Priority<select data-f="priority"' + dis + '>' + opt(PRIORITIES, d.priority) + '</select></label>';
      html += '<label>Effort<select data-f="effort"' + dis + '>' + opt(EFFORTS, d.effort) + '</select></label>';
      if (d.sourceQuote) html += '<div class="quote full">“' + esc(d.sourceQuote) + '”</div>';
      if (dup) {
        html += '<div class="dup-flag">⚠ Looks like a duplicate of “' + esc(dup.title) + '” (' + esc(dup.requester) + ', ' + esc(dup.status) + ').' +
          '<select data-f="action"' + dis + '>' +
          '<option value="merge"' + (d.action === 'merge' ? ' selected' : '') + '>Merge into existing</option>' +
          '<option value="new"' + (d.action === 'new' ? ' selected' : '') + '>Add as new task</option>' +
          '<option value="skip"' + (d.action === 'skip' ? ' selected' : '') + '>Skip this one</option>' +
          '</select></div>';
      }
      html += '</div>';
    });
    if (m.state === 'open') {
      html += '<div class="confirm-actions">' + (m.note ? '<span class="note">' + richText(m.note) + '</span>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-card="discard">Discard</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-card="add">Add all</button></div>';
    } else if (m.note) {
      html += '<div class="note">' + richText(m.note) + '</div>';
    }
    return html + '</div>';
  }

  chatLog.addEventListener('input', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    var draftEl = e.target.closest('.draft'), msgEl = e.target.closest('[data-mid]');
    if (!draftEl || !msgEl) return;
    var m = findMsg(msgEl.getAttribute('data-mid'));
    if (!m || m.state !== 'open') return;
    var d = m.drafts[+draftEl.getAttribute('data-i')];
    if (!d) return;
    d[f] = e.target.value;
    if (f === 'dueDate' || f === 'requester') e.target.classList.toggle('missing', !e.target.value);
    if (f === 'action') draftEl.classList.toggle('skipped', d.action === 'skip');
    persistChat();
  });
  chatLog.addEventListener('change', function (e) {
    // Re-check duplicates when title/requester edits settle.
    var f = e.target.getAttribute('data-f');
    if (f !== 'title' && f !== 'requester') return;
    var msgEl = e.target.closest('[data-mid]');
    var m = msgEl && findMsg(msgEl.getAttribute('data-mid'));
    if (!m || m.state !== 'open') return;
    var before = JSON.stringify(m.drafts.map(function (d) { return d.dupOf; }));
    refreshDuplicates(m);
    if (JSON.stringify(m.drafts.map(function (d) { return d.dupOf; })) !== before) rerenderMsg(m);
    else persistChat();
  });
  chatLog.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (chip) {
      var cm = findMsg(chip.closest('[data-mid]').getAttribute('data-mid'));
      if (cm && cm.chipsOnce) { cm.chipsUsed = true; rerenderMsg(cm); }
      handleUserText(chip.getAttribute('data-chip'));
      return;
    }
    var msgEl = e.target.closest('[data-mid]');
    var m = msgEl && findMsg(msgEl.getAttribute('data-mid'));
    if (!m || m.type !== 'drafts' || m.state !== 'open') return;
    var rm = e.target.closest('[data-draft-remove]');
    if (rm) {
      m.drafts.splice(+rm.getAttribute('data-draft-remove'), 1);
      if (!m.drafts.length) { m.state = 'discarded'; m.note = 'All tasks removed.'; if (pending && pending.msgId === m.id) pending = null; }
      rerenderMsg(m);
      return;
    }
    var act = e.target.closest('[data-card]');
    if (!act) return;
    if (act.getAttribute('data-card') === 'discard') discardCard(m);
    else commitCard(m);
  });

  function discardCard(m) {
    m.state = 'discarded'; m.note = 'Discarded — nothing was added.';
    if (pending && pending.msgId === m.id) pending = null;
    rerenderMsg(m);
    addMsg({ role: 'assistant', type: 'text', text: 'Okay, discarded those. Nothing was added to the board.' });
  }

  function commitCard(m) {
    var added = [], merged = [], skipped = 0, invalid = 0;
    m.drafts.forEach(function (d) {
      if (d.action === 'skip') { skipped++; return; }
      var clean = sanitizeTask({
        title: d.title, description: d.description, dueDate: d.dueDate, requester: d.requester || 'Me',
        priority: d.priority, effort: d.effort, status: 'To Do', source: d.source || 'Meeting', sourceQuote: d.sourceQuote
      });
      if (!clean) { invalid++; return; }
      var target = d.action === 'merge' && d.dupOf ? findTask(d.dupOf) : null;
      if (target) {
        if (clean.dueDate) target.dueDate = clean.dueDate;
        if (PRIORITY_RANK[clean.priority] < PRIORITY_RANK[target.priority]) target.priority = clean.priority;
        if (!target.description && clean.description) target.description = clean.description;
        if (clean.sourceQuote) target.sourceQuote = clean.sourceQuote;
        merged.push(target);
      } else {
        tasks.push(clean); added.push(clean);
      }
    });
    if (!added.length && !merged.length) {
      addMsg({ role: 'assistant', type: 'text', kind: 'error', text: invalid ? 'Every task needs a title — fill one in and try again.' : 'Nothing to add — all tasks were skipped.' });
      if (!invalid) { m.state = 'discarded'; m.note = 'All skipped.'; rerenderMsg(m); }
      return;
    }
    persistTasks();
    flash(added.concat(merged).map(function (t) { return t.id; }));
    renderBoard();
    m.state = 'added';
    m.note = 'Added to board.';
    if (pending && pending.msgId === m.id) pending = null;
    rerenderMsg(m);
    var parts = [];
    if (added.length) parts.push('Added **' + added.length + '** task' + (added.length === 1 ? '' : 's') + ' to To Do');
    if (merged.length) parts.push('merged ' + merged.length + ' into existing: ' + merged.map(function (t) { return '“' + t.title + '”'; }).join(', '));
    if (skipped) parts.push('skipped ' + skipped);
    var text = cap(parts.join('; ')) + '.';
    addMsg({
      role: 'assistant', type: 'list', text: text, items: added.concat(merged).map(function (t) {
        return { title: t.title, meta: t.requester + ' · ' + prettyDate(t.dueDate) + ' · ' + t.priority };
      })
    });
  }

  // ---------------------------------------------------------------------------
  // Extraction — local rule-based parser
  // ---------------------------------------------------------------------------
  var VERBS = ['send', 'draft', 'review', 'fix', 'prepare', 'schedule', 'update', 'share', 'write', 'create', 'finish', 'finalize',
    'follow up', 'follow-up', 'call', 'email', 'book', 'set up', 'setup', 'check', 'investigate', 'deploy', 'test', 'submit', 'organize',
    'organise', 'plan', 'compile', 'present', 'arrange', 'sync', 'reach out', 'ping', 'merge', 'file', 'refactor', 'document', 'migrate',
    'publish', 'build', 'design', 'complete', 'confirm', 'collect', 'analyze', 'analyse', 'clean up', 'look into', 'circulate', 'reply',
    'respond', 'approve', 'sign off', 'escalate', 'raise', 'add', 'remove', 'implement', 'resolve', 'debug', 'ship', 'release', 'order',
    'renew', 'invite', 'notify', 'demo', 'audit', 'estimate', 'benchmark', 'track', 'coordinate', 'gather', 'get', 'put together', 'run', 'talk to', 'loop in'];
  var VERB_RE_SRC = VERBS.map(function (v) { return v.replace(/[-\s]/g, '[\\s-]'); }).sort(function (a, b) { return b.length - a.length; }).join('|');
  var VERB_RE = new RegExp('\\b(' + VERB_RE_SRC + ')(?:s|es|ed|ing)?\\b', 'i');
  var LEAD_VERB_RE = new RegExp('(?:\\b(?:to|please|pls|will|\'ll|must|should|need to|needs to|have to|has to|can you|could you|let\'s|lets|gonna|going to)\\s+)(?:also\\s+|quickly\\s+)?(' + VERB_RE_SRC + ')\\b', 'i');
  var START_VERB_RE = new RegExp('^(?:also\\s+|then\\s+|and\\s+)?(' + VERB_RE_SRC + ')\\b', 'i');
  var NOT_NAMES = ('I We You They He She It The A An This That Please Also Then And But So Monday Tuesday Wednesday Thursday Friday Saturday Sunday ' +
    'January February March April May June July August September October November December Jira Slack Zoom Google Gemini Today Tomorrow Team Everyone ' +
    'Someone Action Next Our My Let Can Could Would Should Will Okay Ok Yes No Note Hi Hey PR API').split(' ');

  function isName(w) { return /^[A-Z][a-zA-Z'’-]{1,}$/.test(w) && NOT_NAMES.indexOf(w) < 0; }

  function detectRequester(s) {
    var m;
    var strong = [
      /\b([A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+)?)\s+(?:has\s+|had\s+|just\s+)?(?:asked|wants|wanted|requested|needs|needed|told me|said|would like|is asking|was asking|reminded|assigned|suggested|mentioned)\b/,
      /^([A-Z][a-z'’-]+)\s*[:,\-–]\s*(?:can|could|would|please|pls|we need|i need|need)\b/i,
      /\b(?:per|from|on behalf of|requested by|asked by|assigned by)\s+([A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+)?)\b/
    ];
    for (var i = 0; i < strong.length; i++) {
      m = s.match(strong[i]);
      if (m) {
        var parts = m[1].split(/\s+/).filter(isName);
        if (parts.length) return parts.join(' ');
      }
    }
    if (/\b(i need to|i'll|i will|i have to|i must|i should|remind me|i've got to|note to self|i'm going to|i am going to|my todo|my task|i gotta|i want to)\b/i.test(s)) return 'Me';
    return '';
  }

  function detectPriority(s) {
    if (/\b(urgent|urgently|asap|critical|blocker|blocking|high[\s-]priority|top priority|p0|p1|immediately|right away|sev ?1)\b/i.test(s)) return 'High';
    if (/\b(low[\s-]priority|no rush|whenever|nice to have|if (?:you|we) have time|not urgent|someday|eventually)\b/i.test(s)) return 'Low';
    return 'Medium';
  }
  function detectEffort(s) {
    if (/\b(quick|quickly|small|minor|simple|tiny|5[\s-]min|five minutes|just|ping|reply|confirm|book|send|share|email)\b/i.test(s)) return 'Small';
    if (/\b(overhaul|migrate|migration|rewrite|redesign|large|big|major|full|entire|end[\s-]to[\s-]end|architecture|roadmap|build out)\b/i.test(s)) return 'Large';
    return 'Medium';
  }

  function splitSegments(text) {
    var lines = text.replace(/\r/g, '').split('\n');
    var out = [];
    lines.forEach(function (line) {
      var l = line.replace(/^\s*(?:[-*•▪◦·>]|\d+[.)]|\[\s?[x ]?\s?\])\s*/i, '').trim();
      if (!l) return;
      // Strip headings like "Action items:"
      if (/^(action items?|next steps|todos?|to-dos?|follow[\s-]?ups?|notes?|summary|attendees?|agenda)\s*:?\s*$/i.test(l)) return;
      l = l.replace(/^(action items?|todo|to-do|ai|next steps?|follow[\s-]?up)\s*:\s*/i, '');
      // Split into sentences (avoid splitting on decimals / abbreviations like "e.g.")
      var sentences = l.split(/(?<=[.!?;])\s+(?=[A-Z"“'])/);
      sentences.forEach(function (s) { s = s.trim(); if (s) out.push(s); });
    });
    return out;
  }

  function buildTitle(sentence, dateMatch) {
    var s = sentence;
    var m = s.match(LEAD_VERB_RE);
    var idx = -1;
    if (m) idx = s.toLowerCase().indexOf(m[1].toLowerCase(), m.index);
    if (idx < 0) { m = s.match(START_VERB_RE); if (m) idx = s.toLowerCase().indexOf(m[1].toLowerCase()); }
    if (idx < 0) { m = s.match(VERB_RE); if (m) idx = m.index; }
    var t = idx >= 0 ? s.slice(idx) : s;
    if (dateMatch) t = t.replace(dateMatch, ' ');
    t = t.replace(/\b(asap|urgently|please|pls|as soon as possible|right away|immediately|if possible|for me|when you get a chance)\b/gi, ' ')
      .replace(/\b(high|low)[\s-]priority\b/gi, ' ')
      .replace(/\s*[(\[].*?[)\]]\s*$/, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;:\-–]+|[\s,;:\-–.!?]+$/g, '')
      .replace(/\s+(and|so|but|or|by|on|before|until|for)$/i, '');
    // Rewrite second-person / first-person pronouns into neutral task phrasing.
    t = t.replace(/\b(him|her|them)\b/gi, function (w) { return w; }).replace(/\bme\b/g, 'me');
    return clip(cap(t), 90);
  }

  function localExtract(text) {
    var segs = splitSegments(text);
    var drafts = [];
    segs.forEach(function (s) {
      var actionable = VERB_RE.test(s) || /\b(need to|needs to|action item|todo|to-do|follow up|asked|can you|could you|please)\b/i.test(s);
      if (!actionable) return;
      if (/^(thanks|thank you|great|ok|okay|sounds good|cool)\b/i.test(s) && s.length < 30) return;
      var dm = parseDateFrom(s);
      var title = buildTitle(s, dm && dm.match);
      if (!title || title.split(' ').length < 2) return;
      var req = detectRequester(s);
      var desc = clip(s, 220);
      drafts.push({
        title: title,
        description: desc,
        dueDate: dm ? dm.date : '',
        requester: req,
        priority: detectPriority(s),
        effort: detectEffort(title),
        source: /\b[A-Z]{2,}-\d+\b/.test(s) ? 'Jira' : 'Meeting',
        sourceQuote: clip(s, 300)
      });
    });
    return drafts;
  }

  // ---------------------------------------------------------------------------
  // Extraction — Gemini
  // ---------------------------------------------------------------------------
  function geminiSystemInstruction() {
    var t = startOfToday();
    var dow = DAY_NAMES[t.getDay()];
    return [
      'You extract action items from meeting notes, chat messages and summaries for a task tracker called CommitDesk.',
      'Today is ' + cap(dow) + ', ' + todayStr() + ' (YYYY-MM-DD). Resolve every relative date against today: "today"/"EOD" = ' + todayStr() +
        ', "tomorrow" = ' + addDays(1) + ', weekday names mean the next occurrence of that day (today counts if it is that day), ' +
        '"end of week"/"EOW" = the coming Friday (' + addDays(daysUntilWeekday(5, true)) + '), "next week" = next Monday (' + addDays(daysUntilWeekday(1, false)) + ').',
      'Return ONLY a JSON array (no wrapper object, no markdown). Each element must have exactly these keys:',
      '{"title": string (imperative, max 90 chars, keep ticket keys like PAY-123 as a "PAY-123: " prefix),',
      ' "description": string (1-2 sentences of useful context),',
      ' "dueDate": "YYYY-MM-DD" or null if no deadline is stated or implied,',
      ' "requester": the person who asked for the work (e.g. "Rahul asked..." -> "Rahul"; "Priya: can you..." -> "Priya"); "Me" if the speaker assigns it to themselves in the first person ("I need to", "I\'ll"); null if it is genuinely unclear,',
      ' "priority": "High" | "Medium" | "Low" (default "Medium"; High for urgent/ASAP/blocker, Low for no-rush),',
      ' "effort": "Small" | "Medium" | "Large" (default "Medium"),',
      ' "status": "To Do",',
      ' "source": "Meeting" (or "Jira" when the item references a Jira ticket key),',
      ' "sourceQuote": the exact sentence or bullet from the input that this item came from, copied verbatim}.',
      'Extract EVERY distinct action item, including ones assigned to other people. Split sentences that contain multiple separate actions.',
      'Do not invent deadlines or requesters. If there are no action items, return [].'
    ].join('\n');
  }

  function geminiExtract(text) {
    return callGemini(geminiSystemInstruction(), text).then(function (out) { return validateGemini(out, text); });
  }

  // Generic Gemini JSON call: resolves with the model's raw JSON text.
  function callGemini(systemText, userText) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelName()) +
      ':generateContent?key=' + encodeURIComponent(settings.apiKey.trim());
    var body = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    };
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.text().then(function (raw) {
        if (timer) clearTimeout(timer);
        var data = null;
        try { data = JSON.parse(raw); } catch (e) { /* handled below */ }
        if (!res.ok) {
          var msg = data && data.error && data.error.message ? data.error.message : 'HTTP ' + res.status;
          var err = new Error(msg); err.status = res.status; throw err;
        }
        var part = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
          data.candidates[0].content.parts && data.candidates[0].content.parts[0];
        if (!part || typeof part.text !== 'string') throw new Error('Gemini returned an empty response.');
        return part.text;
      });
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw new Error(e && e.name === 'AbortError' ? 'The request timed out.' : 'Network error — could not reach Gemini.');
    });
  }

  function parseModelJSON(jsonText) {
    var cleaned = String(jsonText || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(cleaned); } catch (e) { throw new Error('Gemini returned malformed JSON.'); }
  }

  function validateGemini(jsonText, input) {
    var parsed = parseModelJSON(jsonText);
    if (parsed && !Array.isArray(parsed)) parsed = parsed.tasks || parsed.items || parsed.actionItems || parsed.action_items || null;
    if (!Array.isArray(parsed)) throw new Error('Gemini did not return a list of tasks.');
    var out = [];
    parsed.slice(0, 30).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var title = clip(typeof it.title === 'string' ? it.title : '', 90);
      if (!title) return;
      var quote = typeof it.sourceQuote === 'string' ? clip(it.sourceQuote, 300) : '';
      var req = typeof it.requester === 'string' ? clip(it.requester, 60) : '';
      if (/^(null|none|unknown|n\/a|unclear)$/i.test(req)) req = '';
      if (/^(me|myself|i|self)$/i.test(req)) req = 'Me';
      var due = typeof it.dueDate === 'string' ? validDate(it.dueDate.trim()) : '';
      out.push({
        title: cap(title),
        description: clip(typeof it.description === 'string' ? it.description : '', 300) || (quote || title),
        dueDate: due,
        requester: req,
        priority: oneOf(it.priority, PRIORITIES, 'Medium'),
        effort: oneOf(it.effort, EFFORTS, 'Medium'),
        source: oneOf(it.source, ['Jira', 'Meeting'], 'Meeting'),
        sourceQuote: quote
      });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Extraction flow with follow-up questions
  // ---------------------------------------------------------------------------
  function startDrafts(drafts, engine, note) {
    drafts.forEach(function (d) { d.action = 'new'; d.dupOf = null; });
    var m = { role: 'assistant', type: 'drafts', drafts: drafts, engine: engine, state: 'open', note: note || '' };
    refreshDuplicates(m);
    m.id = mid(); m.at = Date.now();
    // Hold the card until missing info is gathered.
    m.hidden = true;
    chat.push(m);
    persistChat();
    askNextOrShow(m);
  }

  function askNextOrShow(m) {
    var missDate = [], missReq = [];
    m.drafts.forEach(function (d, i) {
      if (!d.dueDate && !d.askedDate) missDate.push(i);
      if (!d.requester && !d.askedReq) missReq.push(i);
    });
    function names(idxs) { return idxs.map(function (i) { return '“' + m.drafts[i].title + '”'; }).join(', '); }
    if (missDate.length) {
      pending = { msgId: m.id, field: 'dueDate', idxs: missDate };
      addMsg({
        role: 'assistant', type: 'text', chipsOnce: true,
        text: missDate.length === 1 ? 'When is ' + names(missDate) + ' due?' : 'When are these due: ' + names(missDate) + '?',
        note: missDate.length > 1 ? 'One answer applies to all of them — you can fine-tune each in the card next.' : '',
        chips: ['Today', 'Tomorrow', 'Friday', 'Next week', 'No due date']
      });
      return;
    }
    if (missReq.length) {
      pending = { msgId: m.id, field: 'requester', idxs: missReq };
      var suggestions = ['Me'];
      tasks.forEach(function (t) { if (t.requester !== 'Me' && suggestions.indexOf(t.requester) < 0 && suggestions.length < 4) suggestions.push(t.requester); });
      addMsg({
        role: 'assistant', type: 'text', chipsOnce: true,
        text: missReq.length === 1 ? 'Who asked for ' + names(missReq) + '?' : 'Who asked for these: ' + names(missReq) + '?',
        chips: suggestions
      });
      return;
    }
    pending = null;
    refreshDuplicates(m);
    m.hidden = false;
    // Move card to the end of the chat so it appears after the Q&A.
    chat = chat.filter(function (x) { return x !== m; });
    chat.push(m);
    persistChat();
    chatLog.appendChild(renderMsg(m));
    scrollChat();
  }

  function answerPending(text) {
    var m = findMsg(pending.msgId);
    if (!m || m.state !== 'open') { pending = null; return false; }
    var t = text.trim();
    if (/^(cancel|discard|never ?mind|forget it)$/i.test(t)) { addMsg({ role: 'user', type: 'text', text: t }); discardCard(m); return true; }
    if (pending.field === 'dueDate') {
      var skip = /^(skip|no( due)? date|none|no deadline|not sure|unknown|dunno|idk|no)$/i.test(t);
      var dm = skip ? null : parseDateFrom(t);
      if (!skip && !dm) {
        if (t.length > 40 || /\n/.test(t)) return false; // probably a new request — let normal flow handle it
        addMsg({ role: 'user', type: 'text', text: t });
        addMsg({ role: 'assistant', type: 'text', text: 'I couldn\'t read a date from that. Try “Friday”, “tomorrow”, “Oct 24” or “2026-10-24” — or say “skip”.' });
        return true;
      }
      addMsg({ role: 'user', type: 'text', text: t });
      pending.idxs.forEach(function (i) { var d = m.drafts[i]; if (d) { d.askedDate = true; if (dm) d.dueDate = dm.date; } });
    } else {
      if (t.length > 40 || /[?\n]/.test(t) || t.split(/\s+/).length > 5) return false;
      addMsg({ role: 'user', type: 'text', text: t });
      var name = 'Me';
      if (!/^(me|myself|i|i did|skip|mine|no one|nobody|not sure|unknown)$/i.test(t)) {
        var cleaned = t.replace(/^(it was|it's|its|that was|from|by|requested by|asked by)\s+/i, '').replace(/[.!]+$/, '').trim();
        name = cleaned.split(/\s+/).slice(0, 3).map(cap).join(' ') || 'Me';
      }
      pending.idxs.forEach(function (i) { var d = m.drafts[i]; if (d) { d.askedReq = true; d.requester = name; } });
    }
    persistChat();
    askNextOrShow(m);
    return true;
  }

  function extractAndConfirm(text) {
    if (hasKey()) {
      busy = true; setBusy(true); showTyping('Extracting tasks with Gemini');
      geminiExtract(text).then(function (drafts) {
        hideTyping(); busy = false; setBusy(false);
        if (!drafts.length) {
          addMsg({ role: 'assistant', type: 'text', text: 'I didn\'t find any action items in that. Try something like “Rahul asked me to send the pricing deck by Friday”.' });
          return;
        }
        startDrafts(drafts, 'gemini', '');
      }).catch(function (err) {
        hideTyping(); busy = false; setBusy(false);
        var reason = err && err.message ? err.message : 'Unknown error';
        var hint = err && (err.status === 400 || err.status === 401 || err.status === 403) ? ' Check your API key in Settings (⚙).' :
          err && err.status === 404 ? ' The model may be unavailable — try another model name in Settings.' :
          err && err.status === 429 ? ' You\'ve hit the rate limit — wait a moment and try again.' : '';
        var drafts = localExtract(text);
        addMsg({
          role: 'assistant', type: 'text', kind: 'error',
          text: 'Sorry — Gemini couldn\'t process that (' + clip(reason, 160) + ').' + hint +
            (drafts.length ? ' I used the local parser instead.' : '')
        });
        if (drafts.length) startDrafts(drafts, 'local', '');
        else addMsg({ role: 'assistant', type: 'text', text: 'The local parser didn\'t find any action items either.' });
      });
      return;
    }
    var drafts = localExtract(text);
    if (!drafts.length) {
      addMsg({
        role: 'assistant', type: 'text',
        text: 'I couldn\'t spot an action item in that. Try phrasing it like “Rahul asked me to send the pricing deck by Friday”, or paste your meeting notes as bullets.',
        note: 'Tip: add a Gemini API key in Settings (⚙) for much better extraction.'
      });
      return;
    }
    startDrafts(drafts, 'local', 'Parsed locally — add a Gemini key in Settings (⚙) for smarter extraction.');
  }

  // ---------------------------------------------------------------------------
  // Chat commands
  // ---------------------------------------------------------------------------
  function listItems(list) {
    return sortTasks(list).map(function (t) {
      return { title: t.title, meta: t.status + ' · ' + t.requester + ' · ' + (isOverdue(t) ? 'overdue since ' : 'due ') + prettyDate(t.dueDate) + ' · ' + t.priority };
    });
  }
  function replyList(header, list, emptyText) {
    if (!list.length) { addMsg({ role: 'assistant', type: 'text', text: emptyText }); return; }
    addMsg({ role: 'assistant', type: 'list', text: header.replace('{n}', list.length), items: listItems(list) });
  }

  function matchTask(query, preferOpen) {
    var q = query.replace(/^(the|my|that|this)\s+/i, '').replace(/\s+(task|ticket|one|item)$/i, '').trim();
    if (!q) return { none: true };
    var key = q.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
    if (key) {
      var byKey = tasks.filter(function (t) { return t.title.toUpperCase().indexOf(key[1].toUpperCase()) >= 0; });
      if (byKey.length === 1) return { task: byKey[0] };
    }
    var qt = tokens(q);
    if (!qt.length) return { none: true };
    var scored = tasks.map(function (t) {
      var tt = tokens(t.title + ' ' + t.requester);
      var hit = 0;
      qt.forEach(function (w) {
        if (tt.indexOf(w) >= 0) hit += 1;
        else if (w.length >= 4 && tt.some(function (x) { return x.indexOf(w) === 0 || w.indexOf(x) === 0 && x.length >= 4; })) hit += 0.7;
      });
      var score = hit / qt.length;
      if (preferOpen && t.status !== 'Done') score += 0.05;
      return { t: t, score: score, tie: hit / Math.max(tt.length, 1) };
    }).filter(function (x) { return x.score >= 0.6; }).sort(function (a, b) { return b.score - a.score || b.tie - a.tie; });
    if (!scored.length) return { none: true };
    if (scored.length > 1 && Math.abs(scored[0].score - scored[1].score) < 0.01 && Math.abs(scored[0].tie - scored[1].tie) < 0.01) {
      return { ambiguous: scored.slice(0, 4).map(function (x) { return x.t; }) };
    }
    return { task: scored[0].t };
  }

  function notFound(q) {
    addMsg({ role: 'assistant', type: 'text', text: 'I couldn\'t find a task matching “' + q + '”. Try a few words from its title or the ticket key (e.g. PAY-482).' });
  }
  function ambiguous(list) {
    addMsg({ role: 'assistant', type: 'list', text: 'That matches more than one task — which one? Try using more words from the title:', items: listItems(list) });
  }

  function isQuestion(s) { return /\?\s*$/.test(s) || /^(what|what's|whats|which|show|list|any|anything|how many|do i have|is there|are there|tell me)\b/i.test(s); }

  function tryCommand(text) {
    var s = text.trim();
    if (/\n/.test(s) || s.length > 140) return false;
    var lower = s.toLowerCase().replace(/[’]/g, "'");
    var m;

    if (/^(help|\?|what can you do\??|commands)$/i.test(lower)) {
      addMsg({
        role: 'assistant', type: 'text',
        text: 'Paste meeting notes or type a request, and I\'ll turn it into tasks you can review before adding. I also understand:\n' +
          '• **what do I need to deliver today?** (due today + overdue)\n' +
          '• **I have one hour, give me the low-hanging fruit** (open Small tasks)\n' +
          '• **I finished the vendor email** / **mark the API spec as done**\n' +
          '• **what\'s due this week?** / **what\'s in progress?**\n' +
          '• **move PR review to Monday** (or to In Progress)\n' +
          '• **delete the KYC demo task**\n• **standup** — summary copied to clipboard',
        chips: ['What do I need to deliver today?', 'I have one hour, give me the low-hanging fruit', 'Standup']
      });
      return true;
    }
    if (/^(standup|stand-up|stand up|daily standup|generate (?:a )?standup|standup summary)[.!?]*$/i.test(lower)) {
      $('standupBtn').click();
      return true;
    }

    // mark X as done / in progress / to do
    m = s.match(/^(?:please\s+)?(?:mark|set|flag|move)\s+(.+?)\s+(?:as\s+|to\s+|into\s+)?(done|complete|completed|finished|closed|in[\s-]progress|started|to[\s-]?do|open|not started)\s*[.!]*$/i);
    if (m) {
      var st = normStatus(m[2].replace('-', ' '));
      if (st === 'Done') { markDoneFlow(m[1]); return true; }
      var r = matchTask(m[1], true);
      if (r.none) { notFound(m[1]); return true; }
      if (r.ambiguous) { ambiguous(r.ambiguous); return true; }
      if (r.task.status === st) { addMsg({ role: 'assistant', type: 'text', text: '“' + r.task.title + '” is already in ' + st + '.' }); return true; }
      setStatus(r.task, st);
      addMsg({ role: 'assistant', type: 'text', text: (st === 'Done' ? '✅ Nice — marked ' : 'Moved ') + '“' + r.task.title + '” ' + (st === 'Done' ? 'as Done.' : 'to ' + st + '.') });
      return true;
    }
    // move / reschedule X to <date>
    m = s.match(/^(?:please\s+)?(?:move|reschedule|push|postpone|shift|change|bump|delay|set)\s+(?:the\s+)?(.+?)\s+(?:due\s+)?(?:to|till|until|for|on|back to)\s+(.+?)\s*[.!]*$/i);
    if (m) {
      var target = m[2].trim();
      var st2 = normStatus(target);
      var dm = st2 ? null : parseDateFrom(target);
      if (st2 || dm) {
        var r3 = matchTask(m[1].replace(/\s+(?:due date|deadline|date)$/i, ''), true);
        if (r3.none) { notFound(m[1]); return true; }
        if (r3.ambiguous) { ambiguous(r3.ambiguous); return true; }
        if (st2) {
          setStatus(r3.task, st2);
          addMsg({ role: 'assistant', type: 'text', text: 'Moved “' + r3.task.title + '” to ' + st2 + '.' });
        } else {
          r3.task.dueDate = dm.date;
          persistTasks(); flash([r3.task.id]); renderBoard();
          addMsg({ role: 'assistant', type: 'text', text: '📅 Rescheduled “' + r3.task.title + '” to ' + prettyDate(dm.date) + ' (' + dm.date + ').' });
        }
        return true;
      }
    }
    // delete X
    m = s.match(/^(?:please\s+)?(?:delete|remove|drop)\s+(.+?)\s*[.!]*$/i);
    if (m) {
      var r4 = matchTask(m[1], false);
      if (r4.task) {
        var gone = r4.task;
        tasks = tasks.filter(function (t) { return t !== gone; });
        persistTasks(); renderBoard();
        addMsg({ role: 'assistant', type: 'text', text: '🗑️ Deleted “' + gone.title + '”.' });
        return true;
      }
      if (r4.ambiguous) { ambiguous(r4.ambiguous); return true; }
      // otherwise fall through: probably a new task like "remove dead flags from checkout"
    }

    if (!isQuestion(s)) return false;

    if (/\b(overdue|late|past due|missed|behind)\b/.test(lower)) {
      replyList('⚠️ {n} overdue task(s):', tasks.filter(isOverdue), '🎉 Nothing is overdue.');
      return true;
    }
    if (/\b(today|tonight|eod)\b/.test(lower)) {
      replyList('📅 {n} task(s) due today:', tasks.filter(isDueToday), 'Nothing is due today.');
      return true;
    }
    if (/\b(this week|next 7 days|coming week|upcoming)\b/.test(lower)) {
      replyList('🗓️ {n} open task(s) due in the next 7 days:', tasks.filter(function (t) {
        var d = daysFromToday(t.dueDate); return t.status !== 'Done' && d !== null && d >= 0 && d <= 7;
      }), 'Nothing due in the next 7 days.');
      return true;
    }
    if (/\b(in progress|doing|working on)\b/.test(lower)) {
      replyList('🔧 {n} task(s) in progress:', tasks.filter(function (t) { return t.status === 'In Progress'; }), 'Nothing is in progress.');
      return true;
    }
    if (/\b(done|completed|finished)\b/.test(lower)) {
      replyList('✅ {n} completed task(s):', tasks.filter(function (t) { return t.status === 'Done'; }), 'Nothing completed yet.');
      return true;
    }
    if (/\b(high priority|urgent|important)\b/.test(lower)) {
      replyList('🔥 {n} open high-priority task(s):', tasks.filter(function (t) { return t.status !== 'Done' && t.priority === 'High'; }), 'No open high-priority tasks.');
      return true;
    }
    var who = s.match(/\b(?:from|for|by)\s+([A-Z][a-z]+)\b/);
    if (who && /\b(task|tasks|asked|requested|what)\b/i.test(lower)) {
      var nm = who[1].toLowerCase();
      replyList('{n} open task(s) from ' + who[1] + ':', tasks.filter(function (t) { return t.status !== 'Done' && t.requester.toLowerCase().indexOf(nm) >= 0; }), 'No open tasks from ' + who[1] + '.');
      return true;
    }
    var dq = parseDateFrom(s);
    if (dq && /\bdue\b/.test(lower)) {
      replyList('{n} task(s) due ' + prettyDate(dq.date) + ':', tasks.filter(function (t) { return t.status !== 'Done' && t.dueDate === dq.date; }), 'Nothing due ' + prettyDate(dq.date) + '.');
      return true;
    }
    if (/\b(open|all|everything|my tasks|board)\b/.test(lower)) {
      replyList('{n} open task(s):', tasks.filter(function (t) { return t.status !== 'Done'; }), 'No open tasks.');
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------
  function setBusy(b) {
    sendBtn.disabled = b;
    sendBtn.textContent = b ? 'Working…' : 'Send';
  }

  function handleUserText(raw) {
    var text = String(raw || '').trim();
    if (!text || busy) return;
    if (pending && answerPending(text)) return;
    addMsg({ role: 'user', type: 'text', text: text });
    routeMessage(text);
  }

  // ---------------------------------------------------------------------------
  // Intent detection (CR-021): QUERY_TODAY | QUERY_QUICK_WINS | MARK_DONE | CREATE_TASKS
  // ---------------------------------------------------------------------------
  var INTENTS = ['QUERY_TODAY', 'QUERY_QUICK_WINS', 'MARK_DONE', 'CREATE_TASKS'];

  function looksLikeQuery(s) {
    return isQuestion(s) || /\b(give me|show me|show|list|tell me|i have|i've got|i got|what)\b/i.test(s) || !VERB_RE.test(s);
  }
  function stripDoneWords(s) {
    return s.replace(/^\s*(?:ok(?:ay)?|so|yay|great)[,!\s]+/i, '')
      .replace(/^(?:i\s*(?:'ve|have)?\s*(?:just\s+|finally\s+)?(?:finished|completed|wrapped up|did|sent|shipped)|(?:i'?m|i am)\s+(?:all\s+)?done with|done with|please\s+mark|mark(?:ed)?|completed|finished)\s+/i, '')
      .replace(/\s+(?:is|are)\s+(?:done|complete|completed|finished)\b.*$/i, '')
      .replace(/\s+(?:as\s+)?(?:done|complete|completed|finished)\s*[.!]*$/i, '')
      .replace(/[.!?]+$/, '').trim();
  }

  function localIntent(text) {
    var s = text.trim().replace(/[’]/g, "'");
    var short = !/\n/.test(s) && s.split(/\s+/).length <= 20;
    if (short && !/^(what|which|show|list|any|how)\b/i.test(s) &&
        (/\b(i\s*(?:'ve|have)?\s*(?:just\s+|finally\s+)?finished|i'?m (?:all )?done with|done with|completed|i\s+(?:just\s+)?(?:did|sent|shipped))\b/i.test(s) ||
         /\bmark(?:ed)?\b.+\b(done|complete|completed|finished)\b/i.test(s) ||
         /^.{3,80}\s+is\s+(done|complete|completed|finished)[.!]*$/i.test(s))) {
      return { intent: 'MARK_DONE', taskQuery: stripDoneWords(s) };
    }
    if (short && looksLikeQuery(s)) {
      if (/\b(deliver(?:ed|ing)? today|due today|what'?s today|what is today|what'?s (?:on )?(?:for )?today|today'?s (?:tasks|deliverables|list|plan)|on my plate today|(?:do|deliver|finish|ship) today|overdue)\b/i.test(s)) {
        return { intent: 'QUERY_TODAY', taskQuery: null };
      }
      if (/\b(low[\s-]hanging(?: fruit)?|quick(?:est)?|one hour|an hour|1 ?h(?:ou)?r|half an hour|30 min(?:ute)?s?|few minutes|small tasks?|small ones|easy (?:tasks?|wins?|ones?))\b/i.test(s)) {
        return { intent: 'QUERY_QUICK_WINS', taskQuery: null };
      }
    }
    return { intent: 'CREATE_TASKS', taskQuery: null };
  }

  function geminiIntent(text) {
    var sys = [
      'You classify a single chat message sent to CommitDesk, a personal task tracker. Today is ' + todayStr() + '.',
      'Return ONLY JSON: {"intent": one of "QUERY_TODAY" | "QUERY_QUICK_WINS" | "MARK_DONE" | "CREATE_TASKS", "taskQuery": string or null}.',
      'QUERY_TODAY: the user asks what they must deliver/do today, what is due today, or what is overdue.',
      'QUERY_QUICK_WINS: the user has limited time or asks for quick, easy, small, low-effort or "low-hanging fruit" tasks.',
      'MARK_DONE: the user reports finishing a task or asks to mark one as done/complete. taskQuery = the short words identifying that task (e.g. "I finished the vendor email" -> "vendor email").',
      'CREATE_TASKS: anything else — new requests, action items, meeting notes, or other commands such as rescheduling or deleting.',
      'taskQuery is null unless intent is MARK_DONE.'
    ].join('\n');
    return callGemini(sys, text).then(function (raw) {
      var p = parseModelJSON(raw);
      if (Array.isArray(p)) p = p[0];
      var intent = p && typeof p.intent === 'string' ? p.intent.trim().toUpperCase() : '';
      if (INTENTS.indexOf(intent) < 0) throw new Error('Unknown intent');
      var q = p && typeof p.taskQuery === 'string' ? clip(p.taskQuery, 120) : '';
      return { intent: intent, taskQuery: q || (intent === 'MARK_DONE' ? stripDoneWords(text) : null) };
    });
  }

  function routeMessage(text) {
    // Long pastes (meeting summaries) are always task creation — skip the classification round-trip.
    var longPaste = text.length > 600 || text.split('\n').length > 4;
    if (hasKey() && !longPaste) {
      busy = true; setBusy(true); showTyping('Thinking');
      geminiIntent(text).catch(function () { return localIntent(text); }).then(function (r) {
        hideTyping(); busy = false; setBusy(false);
        dispatchIntent(r, text);
      });
      return;
    }
    dispatchIntent(longPaste ? { intent: 'CREATE_TASKS' } : localIntent(text), text);
  }

  function dispatchIntent(r, text) {
    if (r.intent === 'QUERY_TODAY') return replyToday();
    if (r.intent === 'QUERY_QUICK_WINS') return replyQuickWins();
    if (r.intent === 'MARK_DONE') return markDoneFlow(r.taskQuery || stripDoneWords(text));
    if (tryCommand(text)) return;
    extractAndConfirm(text);
  }

  function byPriorityThenDate(a, b) {
    var p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    var da = a.dueDate || '9999-12-31', db = b.dueDate || '9999-12-31';
    return da < db ? -1 : da > db ? 1 : 0;
  }

  function replyToday() {
    var list = tasks.filter(function (t) { return isOverdue(t) || isDueToday(t); }).sort(byPriorityThenDate);
    if (!list.length) {
      addMsg({ role: 'assistant', type: 'text', text: '🎉 Nothing is due today and nothing is overdue. You\'re clear!' });
      return;
    }
    var od = list.filter(isOverdue).length;
    addMsg({
      role: 'assistant', type: 'list',
      text: 'You have **' + list.length + '** thing' + (list.length === 1 ? '' : 's') + ' to deliver today' +
        (od ? ' (' + od + ' overdue)' : '') + ':',
      items: list.map(function (t) {
        var late = -daysFromToday(t.dueDate);
        var label = isOverdue(t) ? '🔴 Overdue ' + late + ' day' + (late === 1 ? '' : 's') : '🟠 Due today';
        return { title: t.title, meta: label + ' · ' + t.requester + ' · ' + t.priority + ' priority · ' + t.status };
      })
    });
  }

  function replyQuickWins() {
    var list = tasks.filter(function (t) { return t.status !== 'Done' && t.effort === 'Small'; }).sort(byPriorityThenDate);
    if (!list.length) {
      addMsg({ role: 'assistant', type: 'text', text: 'No open Small-effort tasks right now. Everything left is Medium or Large effort.' });
      return;
    }
    addMsg({
      role: 'assistant', type: 'list',
      text: '🍒 **' + list.length + '** quick win' + (list.length === 1 ? '' : 's') + ' (Small effort), most important first:',
      items: list.map(function (t) {
        var badge = isOverdue(t) ? 'Overdue' : isDueToday(t) ? 'Due today' : 'Due ' + prettyDate(t.dueDate);
        return { title: t.title, meta: t.priority + ' priority · ' + badge + ' · ' + t.requester };
      })
    });
  }

  // Word-overlap scoring against title (full weight) and description (partial weight).
  function scoreOpenTasks(query, list) {
    var qt = tokens(query);
    if (!qt.length) return [];
    return list.map(function (t) {
      var tt = tokens(t.title), dt = tokens(t.description);
      var hit = 0, titleHit = 0;
      qt.forEach(function (w) {
        if (tt.indexOf(w) >= 0) { hit += 1; titleHit++; }
        else if (w.length >= 4 && tt.some(function (x) { return x.length >= 4 && (x.indexOf(w) === 0 || w.indexOf(x) === 0); })) { hit += 0.75; titleHit++; }
        else if (dt.indexOf(w) >= 0) hit += 0.6;
      });
      var score = hit / qt.length;
      var coverage = tt.length ? Math.min(1, hit / tt.length) : 0;
      return { t: t, score: score, titleHit: titleHit, rank: score + 0.15 * coverage };
    }).filter(function (x) { return x.score >= 0.5 && x.titleHit > 0; }).sort(function (a, b) { return b.rank - a.rank; });
  }
  function localDoneCandidates(query, open) {
    var exact = open.filter(function (t) { return t.title.toLowerCase() === query.toLowerCase(); });
    if (exact.length) return exact.slice(0, 1);
    var key = query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
    if (key) {
      var byKey = open.filter(function (t) { return t.title.toUpperCase().indexOf(key[1].toUpperCase()) >= 0; });
      if (byKey.length) return byKey;
    }
    var scored = scoreOpenTasks(query, open);
    if (!scored.length) return [];
    var top = scored[0].rank;
    return scored.filter(function (x) { return x.rank >= top - 0.08; }).slice(0, 4).map(function (x) { return x.t; });
  }
  function geminiDoneCandidates(query, open) {
    var sys = [
      'You match a user\'s description of a finished piece of work to tasks in their open task list.',
      'Return ONLY JSON: {"matchIds": [task ids, best match first]}.',
      'Return exactly one id when one task clearly matches. Return 2-4 ids only when several tasks are genuinely ambiguous matches.',
      'Return an empty array when no task plausibly matches. Never invent ids.'
    ].join('\n');
    var payload = 'User said they finished: "' + query + '"\n\nOpen tasks:\n' + JSON.stringify(open.map(function (t) {
      return { id: t.id, title: t.title, description: t.description, requester: t.requester };
    }));
    return callGemini(sys, payload).then(function (raw) {
      var p = parseModelJSON(raw);
      var ids = Array.isArray(p) ? p : p && Array.isArray(p.matchIds) ? p.matchIds : null;
      if (!ids) throw new Error('Bad match response');
      var out = [];
      ids.slice(0, 4).forEach(function (id) {
        var t = open.filter(function (x) { return x.id === id; })[0];
        if (t && out.indexOf(t) < 0) out.push(t);
      });
      return out;
    });
  }

  function markDoneFlow(query) {
    query = String(query || '').trim().replace(/^(?:the\s+)?["“'‘]+|["”'’]+$/g, '').trim();
    var open = tasks.filter(function (t) { return t.status !== 'Done'; });
    if (!query) { addMsg({ role: 'assistant', type: 'text', text: 'Which task did you finish? Tell me a few words from its title.' }); return; }
    if (!open.length) { addMsg({ role: 'assistant', type: 'text', text: 'You have no open tasks — everything is already Done.' }); return; }
    var local = localDoneCandidates(query, open);
    // Exact title / unique ticket key: no need to ask the model.
    if (hasKey() && !(local.length === 1 && (local[0].title.toLowerCase() === query.toLowerCase() || /\b[A-Z]+-\d+\b/i.test(query)))) {
      busy = true; setBusy(true); showTyping('Finding that task');
      geminiDoneCandidates(query, open).catch(function () { return local; }).then(function (c) {
        hideTyping(); busy = false; setBusy(false);
        resolveDone(query, c);
      });
      return;
    }
    resolveDone(query, local);
  }

  function resolveDone(query, candidates) {
    if (candidates.length === 1) {
      var t = candidates[0];
      setStatus(t, 'Done');
      addMsg({ role: 'assistant', type: 'text', text: 'Marked \'' + t.title + '\' as done.' });
      return;
    }
    if (candidates.length > 1) {
      addMsg({
        role: 'assistant', type: 'text', chipsOnce: true,
        text: 'A few open tasks match “' + query + '”. Which one did you finish?',
        chips: candidates.map(function (t) { return 'Mark "' + t.title + '" as done'; })
      });
      return;
    }
    var doneHit = scoreOpenTasks(query, tasks.filter(function (t) { return t.status === 'Done'; }))[0];
    addMsg({
      role: 'assistant', type: 'text',
      text: doneHit ? '“' + doneHit.t.title + '” is already Done — I couldn\'t find an open task matching “' + query + '”.' :
        'I couldn\'t find an open task matching “' + query + '”. Try a few words from its title or the ticket key (e.g. PAY-482).'
    });
  }

  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = chatInput.value;
    if (!v.trim() || busy) return;
    chatInput.value = '';
    autosize();
    handleUserText(v);
  });
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (typeof chatForm.requestSubmit === 'function') chatForm.requestSubmit();
      else chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  function autosize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight + 2, 200) + 'px';
  }
  chatInput.addEventListener('input', autosize);

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  var modal = $('settingsModal');
  function openSettings() {
    $('apiKeyInput').value = settings.apiKey || '';
    $('modelInput').value = settings.model || '';
    $('storageNote').textContent = storageOk ? 'Tasks, chat and settings are stored in this browser only.' :
      '⚠ Browser storage is unavailable — data will be lost when you close this tab.';
    modal.hidden = false;
    $('apiKeyInput').focus();
  }
  function closeSettings() { modal.hidden = true; $('settingsBtn').focus(); }
  $('settingsBtn').addEventListener('click', openSettings);
  modal.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closeSettings(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeSettings(); });
  $('settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var key = $('apiKeyInput').value.trim();
    var model = $('modelInput').value.trim();
    var had = hasKey();
    settings.apiKey = key;
    settings.model = model;
    persistSettings();
    renderBoard();
    closeSettings();
    toast(key ? 'Settings saved' : 'Saved — using local parser');
    if (key && !had) addMsg({ role: 'assistant', type: 'text', text: '🔑 Gemini key saved. I\'ll use ' + modelName() + ' to extract tasks from now on.' });
  });
  $('clearKeyBtn').addEventListener('click', function () {
    settings.apiKey = '';
    persistSettings();
    $('apiKeyInput').value = '';
    renderBoard();
    toast('API key removed');
  });
  $('clearChatBtn').addEventListener('click', function () {
    chat = []; pending = null;
    remove(KEYS.chat);
    welcome();
    renderChat();
    closeSettings();
    toast('Chat cleared');
  });
  $('resetDataBtn').addEventListener('click', function () {
    if (!window.confirm('Replace all tasks with the demo data? Your current tasks will be lost.')) return;
    tasks = seedTasks();
    persistTasks();
    renderBoard();
    closeSettings();
    toast('Demo data restored');
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function welcome() {
    chat.push({
      id: mid(), at: Date.now(), role: 'assistant', type: 'text',
      text: '👋 Hi! I\'m CommitDesk. Paste meeting notes or type what someone asked you to do, and I\'ll turn it into tasks you can review before they hit the board.\n\n' +
        'You can also ask **what do I need to deliver today?**, **give me the low-hanging fruit**, say **I finished the vendor email**, or **move PR review to Monday**.',
      note: storageOk ? (hasKey() ? '' : 'Running on the local parser. Add a Gemini API key in Settings (⚙) for smarter extraction.') :
        '⚠ Browser storage is unavailable, so data lives only in this tab.',
      chips: ['Rahul asked me to send the pricing deck to the client by Friday', 'What do I need to deliver today?',
        'I have one hour, give me the low-hanging fruit', 'I finished the vendor email', 'Help']
    });
    persistChat();
  }

  // Drop drafts that were still hidden waiting on a follow-up when the page was closed: show them now.
  chat.forEach(function (m) { if (m.type === 'drafts' && m.hidden) m.hidden = false; });
  chat = chat.filter(function (m) { return m && typeof m === 'object' && typeof m.role === 'string'; });
  if (!chat.length) welcome();
  renderChat();
  renderBoard();

  // Keep "today"/"overdue" badges correct if the tab stays open past midnight.
  var lastDay = todayStr();
  setInterval(function () { if (todayStr() !== lastDay) { lastDay = todayStr(); renderBoard(); } }, 60000);
})();
