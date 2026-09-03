// TestHelper - bookmarklet-версия (одним файлом, тянется закладкой с GitHub).
// Логика та же, что в расширении. Хранилище: localStorage. Меню: панель на странице.
// Работает на kahoot.it и *.classtime.com. Ключ Gemini НЕ вшит - вводится в меню.

(function () {
  "use strict";

  // Горячая перезагрузка: если закладку кликнули повторно (обычно со свежим кодом) -
  // снести прошлый экземпляр (наблюдатель + UI) и запуститься заново.
  if (window.__testhelperCleanup) {
    try { window.__testhelperCleanup(); } catch (e) {}
  }

  const TAG = "[TestHelper]";

  // ================= Хранилище (localStorage вместо browser.storage.local) =================
  const store = {
    get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      arr.forEach((k) => {
        const v = localStorage.getItem("th_" + k);
        if (v !== null) {
          try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
        }
      });
      return Promise.resolve(out);
    },
    set(obj) {
      Object.keys(obj).forEach((k) => localStorage.setItem("th_" + k, JSON.stringify(obj[k])));
      return Promise.resolve();
    },
  };

  // ================= Индикатор состояния =================
  let indicatorEl = null;
  function setIndicator(text, color) {
    if (!indicatorEl) {
      indicatorEl = document.createElement("div");
      Object.assign(indicatorEl.style, {
        position: "fixed", bottom: "12px", right: "12px", zIndex: "2147483647",
        padding: "6px 10px", borderRadius: "8px", font: "13px system-ui, sans-serif",
        color: "#fff", background: "#333", boxShadow: "0 2px 8px rgba(0,0,0,.4)",
        pointerEvents: "none", opacity: "0.95", transition: "background .15s",
      });
      document.body.appendChild(indicatorEl);
    }
    indicatorEl.textContent = "TestHelper: " + text;
    indicatorEl.style.background = color;
  }

  // Плашка типа слева снизу.
  let typeBadgeEl = null;
  function setTypeBadge(text) {
    if (!typeBadgeEl) {
      typeBadgeEl = document.createElement("div");
      Object.assign(typeBadgeEl.style, {
        position: "fixed", bottom: "12px", left: "12px", zIndex: "2147483647",
        padding: "6px 10px", borderRadius: "8px", font: "12px system-ui, sans-serif",
        color: "#fff", background: "#444", boxShadow: "0 2px 8px rgba(0,0,0,.4)",
        pointerEvents: "none", opacity: "0.95",
      });
      document.body.appendChild(typeBadgeEl);
    }
    typeBadgeEl.textContent = "тип: " + text;
  }
  const TYPE_NAME = {
    single: "выбор одного", multi: "мультивыбор", matrix: "Yes/No матрица",
    open: "впиши ответ", fillin: "пропуски/dropdown", sort: "упорядочивание", highlight: "выбор фраз",
    categorize: "категории (drag-drop)", label: "метки на картинку", graph: "график", match: "сопоставление",
    dragfill: "плитки в пропуски", voice: "скажи голосом", mathinput: "матем. ввод", draw: "рисование",
    fibbox: "впиши в коробки", hotspot: "клик по картинке", catgrid: "категории (галочки)",
  };
  const TYPE_LABEL = { unknown: "неизвестный", graph: "график (не поддерживается)" };

  // Оверлей с текстом ответа (open-ended).
  let overlayEl = null;
  function showAnswer(text) {
    if (!overlayEl) {
      overlayEl = document.createElement("div");
      Object.assign(overlayEl.style, {
        position: "fixed", bottom: "46px", right: "12px", zIndex: "2147483647",
        maxWidth: "380px", maxHeight: "45vh", overflow: "auto", padding: "10px 12px",
        borderRadius: "8px", font: "13px system-ui, sans-serif", lineHeight: "1.45",
        color: "#eee", background: "#1f1f27", border: "1px solid #6c5ce7",
        boxShadow: "0 4px 16px rgba(0,0,0,.5)", whiteSpace: "pre-wrap",
        pointerEvents: "auto", userSelect: "text",
      });
      document.body.appendChild(overlayEl);
    }
    overlayEl.textContent = "💡 " + text;
    overlayEl.style.display = "block";
  }
  function hideAnswer() {
    if (overlayEl) overlayEl.style.display = "none";
  }

  // ================= Общие помощники =================
  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function extractText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".katex").forEach((k) => {
      const tex = k.querySelector('annotation[encoding="application/x-tex"]');
      const latex = tex ? tex.textContent.trim() : k.textContent;
      k.replaceWith(document.createTextNode(tex ? "$" + latex + "$" : latex));
    });
    return norm(clone.textContent);
  }

  async function fetchMediaBase64(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    const mime = blob.type || "application/octet-stream";
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    return { mime: mime, b64: String(dataUrl).split(",")[1] };
  }

  function styleHighlight(hls, el, confidence) {
    if (!el) return;
    const color = confidence >= 0.8 ? "#22c55e" : "#eab308";
    el.style.setProperty("outline", "4px solid " + color, "important");
    el.style.setProperty("outline-offset", "-2px", "important");
    el.style.setProperty("box-shadow", "0 0 18px 3px " + color, "important");
    el.style.setProperty("border-radius", "8px", "important");
    hls.push(el);
  }
  function styleClear(hls) {
    hls.forEach((el) => {
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
      el.style.removeProperty("box-shadow");
      el.style.removeProperty("border-radius");
    });
    hls.length = 0;
  }

  function signature(q) {
    if (q.sigKey) return q.sigKey;
    return (q.type || "single") + "||" + q.question;
  }

  // ================= Адаптеры =================
  const kahootAdapter = {
    name: "kahoot",
    matches: (h) => h.endsWith("kahoot.it"),
    _hls: [],
    SEL_QUESTION: '[data-functional-selector="block-title"]',
    SEL_ANSWER_BTN: '[data-functional-selector^="answer-"]',
    SEL_CHOICE_TEXT: '[data-functional-selector^="question-choice-text-"]',

    readQuestion() {
      const qEl = document.querySelector(this.SEL_QUESTION);
      if (!qEl) return null;
      const question = extractText(qEl);
      if (!question) return null;
      const btns = Array.from(document.querySelectorAll(this.SEL_ANSWER_BTN));
      const options = btns
        .map((btn) => {
          const dfs = btn.getAttribute("data-functional-selector") || "";
          const index = parseInt(dfs.replace("answer-", ""), 10);
          const txtEl = btn.querySelector(this.SEL_CHOICE_TEXT);
          return { index: index, text: extractText(txtEl || btn) };
        })
        .sort((a, b) => a.index - b.index);
      const imgEl = document.querySelector('[data-functional-selector="media-container__media-image"]');
      const imageUrl = imgEl ? imgEl.src : null;
      return { question: question, options: options, imageUrl: imageUrl, type: "single" };
    },

    highlight(index, confidence) {
      const btn = document.querySelector('[data-functional-selector="answer-' + index + '"]');
      if (!btn) { console.warn(TAG, "кнопка answer-" + index + " не найдена"); return; }
      styleHighlight(this._hls, btn, confidence);
    },
    highlightEl(el, confidence) { styleHighlight(this._hls, el, confidence); },
    clearHighlight() { styleClear(this._hls); },
  };

  const classtimeAdapter = {
    name: "classtime",
    matches: (h) => h.includes("classtime.com"),
    _hls: [],
    SEL_QUESTION: '[class*="styles__questionTitle"], [class*="questionDescription"]',
    SEL_CHOICE_WRAP: '[class*="choiceWrapperWithTts"]',
    SEL_CHOICE_TEXT: '[class*="choiceComponent"]',
    SEL_MATRIX_ROW: 'tr[data-testid="question-answer-row"]',

    detectType(nWraps) {
      if (document.querySelector('[class*="hotspotImage"], [class*="hotspotForm"]')) return "hotspot"; // точка на картинке
      const catForm = document.querySelector('[data-testid="student-categorizer-answers-form"]');
      if (catForm && catForm.querySelector("input[type=checkbox]")) return "catgrid"; // categorizer с чекбоксами (много категорий на позицию); radio-версия -> matrix ниже
      if (nWraps > 0) {
        return document.querySelector("input[type=checkbox]") ? "multi" : "single";
      }
      if (document.querySelector('[data-testid="student-sorter-choice"]')) return "sort";
      if (document.querySelector('[data-testid="highlight-text-choice"]')) return "highlight";
      if (document.querySelector(this.SEL_MATRIX_ROW)) return "matrix";
      if (document.querySelector("textarea") || document.querySelector('[data-testid="slate-content-editable"]')) return "open";
      if (document.querySelector('[class*="pressableGap"]')) return "fillin";
      if (document.querySelector("input[type=radio]")) return "matrix";
      return "fillin";
    },

    readQuestion() {
      const qEl = document.querySelector(this.SEL_QUESTION);
      if (!qEl) return null;
      const question = extractText(qEl);
      if (!question) return null;
      const wraps = Array.from(document.querySelectorAll(this.SEL_CHOICE_WRAP));
      const type = this.detectType(wraps.length);
      const options = wraps.map((w, i) => {
        const txtEl = w.querySelector(this.SEL_CHOICE_TEXT);
        return { index: i, text: extractText(txtEl || w) };
      });
      const imgEl = document.querySelector('[class*="questionWrapper"] img');
      const imageUrl = imgEl ? imgEl.src : null;
      const audEl = document.querySelector('[data-testid="audio-player"] audio');
      const audioUrl = audEl && (audEl.src || audEl.currentSrc) ? audEl.src || audEl.currentSrc : null;

      const q = { question: question, options: options, imageUrl: imageUrl, audioUrl: audioUrl, type: type };
      const passEl = document.querySelector('[data-testid="context-material-text"]');
      if (passEl) q.passage = norm(passEl.textContent);
      if (type === "matrix") {
        q.rows = Array.from(document.querySelectorAll(this.SEL_MATRIX_ROW)).map((tr) => {
          const rd = tr.querySelectorAll('input[type="radio"]');
          const th = tr.querySelector("th");
          return { text: extractText(th || tr), yesEl: rd[0] || null, noEl: rd[1] || null };
        });
      }
      if (type === "fillin") {
        q.gapEls = Array.from(document.querySelectorAll('[class*="pressableGap"]'));
        const instr = document.querySelector('[class*="questionInstruction"]');
        q.template = instr ? norm(instr.textContent) : "";
      }
      if (type === "sort") {
        q.items = Array.from(document.querySelectorAll('[data-testid="student-sorter-choice-content"]'))
          .map((e) => extractText(e))
          .filter(Boolean);
      }
      if (type === "highlight") {
        q.segEls = Array.from(document.querySelectorAll('[data-testid="highlight-text-choice"]'));
        q.options = q.segEls.map((el, i) => ({
          index: i,
          text: extractText(el.querySelector('[data-testid="highlight-text-choice-content"]') || el),
        }));
      }
      if (type === "hotspot") {
        const hi = document.querySelector('[class*="hotspotImage"]');
        if (hi && hi.src) q.imageUrl = hi.src; // картинку в vision -> подсказка ГДЕ ставить точку
      }
      if (type === "catgrid") {
        q.categories = Array.from(document.querySelectorAll('[data-testid="category-header-cell"]')).map((e) => norm(e.textContent)).filter(Boolean);
        const rowEls = Array.from(document.querySelectorAll('tr[data-testid="question-answer-row"]'));
        q.catRows = rowEls.map((tr) => ({ text: extractText(tr.querySelector("th") || tr), boxes: Array.from(tr.querySelectorAll('input[type=checkbox]')) }));
        q.items = q.catRows.map((r) => r.text);
      }
      return q;
    },

    highlight(index, confidence) {
      const el = document.querySelectorAll(this.SEL_CHOICE_WRAP)[index];
      if (!el) { console.warn(TAG, "вариант #" + index + " не найден"); return; }
      styleHighlight(this._hls, el, confidence);
    },
    highlightEl(el, confidence) { styleHighlight(this._hls, el, confidence); },
    clearHighlight() { styleClear(this._hls); },
  };

  // Quizizz (теперь домен wayground.com). Tailwind-классы + немного data-testid.
  const quizizzAdapter = {
    name: "quizizz",
    matches: (h) => h.includes("wayground.com") || h.includes("quizizz.com"),
    _hls: [],
    SEL_QUESTION: '[data-testid="question-container-text"]',
    SEL_OPTION: '[class*="options-grid"] button[class*="option"]',

    detectType() {
      if (document.querySelector('[class*="dropzone-1"]')) return "categorize";
      if (document.querySelector('[class*="droppable-blank"]')) {
        // droppable-blank и у label (метки на картинку), и у dragfill (текстовые плитки в пропуски)
        const diagram = Array.from(document.querySelectorAll("img")).some((i) => i.naturalWidth > 200 && !/avatar|coin/i.test(i.src));
        return diagram ? "label" : "dragfill";
      }
      const moInner = document.querySelector('[class*="match-order-options-inner"]');
      if (moInner && moInner.children.length >= 2) return "match"; // 2 ряда (описания + термины)
      if (document.querySelector('[class*="match-order-option"]')) return "sort"; // reorder (1 ряд)
      if (document.querySelector('[class*="options-dropdown"]')) return "fillin"; // dropdown-пропуски
      if (document.querySelector('[data-testid="graphing-canvas"]')) return "graph"; // построить график
      if (document.querySelector('[class*="record-button"], [class*="video-record-option"]')) return "voice"; // запись голосом -> генерим текст
      if (document.querySelector('[class*="mathquill"], [class*="keypad-container"]')) return "mathinput"; // math-пад -> голый ответ
      if (document.querySelector('[class*="draw-question-container"], [class*="draw-canvas-editor"]')) return "draw"; // рисование на холсте -> словесная подсказка
      if (document.querySelector('[class*="fib-box-input"]')) return "fibbox"; // впиши в коробки (typed fill-in)
      if (document.querySelector('[class*="hotspot-question"], [class*="hotspot-gameplay"]')) return "hotspot"; // клик по точке на картинке
      if (document.querySelectorAll(this.SEL_OPTION).length >= 2) {
        return document.querySelector('[class*="options-grid"] button[class*="is-msq"]') ? "multi" : "single"; // is-msq = multi-select чекбоксы
      }
      if (document.querySelector('.ProseMirror, [contenteditable="true"], textarea')) return "open";
      return "single";
    },

    readQuestion() {
      const qEl = document.querySelector(this.SEL_QUESTION);
      if (!qEl) return null;
      let question = extractText(qEl).replace(/^Question text:\s*/i, "");
      if (!question) return null;
      const type = this.detectType();
      const btns = Array.from(document.querySelectorAll(this.SEL_OPTION));
      const options = btns.map((b, i) => {
        const text = extractText(b).replace(new RegExp("\\s*" + (i + 1) + "$"), "");
        return { index: i, text: text };
      });
      const imgEl = document.querySelector('[class*="question"] img:not([src*="avatar"])');
      const imageUrl = imgEl && imgEl.naturalWidth > 100 ? imgEl.src : null;
      // аудио-вопрос: есть виджет-визуализатор, но <audio> без src (Web Audio) -> URL берём из performance
      const audCont = document.querySelector('[data-testid="audio-container"], .audio-container');
      let audioUrl = null;
      if (audCont) {
        const ents = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /audioQuestions/i.test(u));
        audioUrl = ents.length ? ents[ents.length - 1] : null;
      }
      const q = { question: question, options: options, imageUrl: imageUrl, audioUrl: audioUrl, type: type };
      // reading-comprehension: текст-пассаж слева -> прикладываем ко всем подвопросам (ядро юзает q.passage).
      // offsetParent-гард: скрытый/оставшийся от прошлого блока reader не должен подтекать в чужой вопрос
      const passEl = document.querySelector('[class*="comprehension-reader"]');
      if (passEl && passEl.offsetParent !== null) q.passage = norm(passEl.textContent).replace(/^Прочитайте приведённый ниже текст\s*/i, "");
      if (type === "hotspot") {
        // картинка часто фоном/внутри контейнера, не в общем <img>
        const cont = document.querySelector('[class*="hotspot-question"], [class*="hotspot-gameplay"]');
        let url = null;
        if (cont) {
          const im = cont.querySelector("img");
          if (im && im.naturalWidth > 150 && !/avatar|coin/i.test(im.src)) url = im.src;
          if (!url) { const m = (getComputedStyle(cont).backgroundImage || "").match(/url\("?(.+?)"?\)/); if (m) url = m[1]; }
        }
        if (url) q.imageUrl = url;
      }
      if (type === "categorize") {
        // категории = dropzone-N (кроме пула dropzone-unc), текст = название
        q.categories = Array.from(document.querySelectorAll('[class*="dropzone-"]'))
          .filter((d) => !/dropzone-unc/.test(d.className))
          .map((d) => norm(d.textContent).replace(/\s*\(\d+\)\s*$/, "").slice(0, 40))
          .filter(Boolean);
        // опции = картинки (текста нет) - для vision
        q.optItems = Array.from(document.querySelectorAll('img[alt="Option image"]')).map((img) => ({ imageUrl: img.src }));
      }
      if (type === "sort") {
        q.items = Array.from(document.querySelectorAll('[class*="match-order-option-inner"]'))
          .map((e) => extractText(e))
          .filter(Boolean);
      }
      if (type === "match") {
        const inner = document.querySelector('[class*="match-order-options-inner"]');
        const rows = inner ? Array.from(inner.children) : [];
        const rowItems = (r) => Array.from(r.querySelectorAll('[class*="match-order-option-inner"]')).map((e) => extractText(e)).filter(Boolean);
        q.prompts = rows[0] ? rowItems(rows[0]) : [];
        q.answers = rows[1] ? rowItems(rows[1]) : [];
      }
      if (type === "label") {
        q.labels = Array.from(document.querySelectorAll('[class*="drag-option-dnd-image"]'))
          .map((e) => extractText(e))
          .filter(Boolean);
        // картинка-диаграмма (крупная, не аватар/монета)
        const big = Array.from(document.querySelectorAll("img")).find((i) => i.naturalWidth > 200 && !/avatar|coin/i.test(i.src));
        if (big) q.imageUrl = big.src;
      }
      if (type === "dragfill") {
        // текстовые плитки в подписанные пропуски (Signs / What to Do / Result / Final Answer)
        const blankEls = document.querySelectorAll('[class*="droppable-blank"]');
        q.tiles = Array.from(document.querySelectorAll('[data-testid^="dnd-option-"]')).map((e) => extractText(e)).filter(Boolean);
        // стабильный текст: вставленные плитки убрать, пропуски -> "___" (иначе заполнение меняет подпись и запускает заново)
        const clone = qEl.cloneNode(true);
        clone.querySelectorAll('[data-testid^="dnd-option-"], [class*="drag-option"]').forEach((t) => t.remove());
        clone.querySelectorAll('[class*="droppable-blank"]').forEach((b) => b.replaceWith(document.createTextNode(" ___ ")));
        q.question = norm(clone.textContent).replace(/^Question text:\s*/i, "");
        // метки пропусков: "N) Label:" (число с пробелом/началом слева, чтоб не ловить "24)" в "(-24)")
        let prompts = [...q.question.matchAll(/(?:^|\s)[1-9]\)\s*([^]*?)(?=\s[1-9]\)|$)/g)].map((m) => m[1].replace(/_+/g, "").replace(/:\s*$/, "").trim()).filter(Boolean);
        if (prompts.length !== blankEls.length) prompts = Array.from(blankEls).map((_, i) => "Пропуск " + (i + 1));
        q.prompts = prompts;
        // ЖЕЛЕЗНАЯ подпись: только мат-префикс (текст до "N)") + число пропусков. От раскладки плиток не зависит.
        const mathPrefix = norm(extractText(qEl)).replace(/^Question text:\s*/i, "").split(/\s[1-9]\)/)[0];
        q.sigKey = "dragfill||" + mathPrefix + "||" + blankEls.length;
      }
      if (type === "fibbox") {
        q.boxCount = document.querySelectorAll('[class*="fib-box-input"]').length;
      }
      if (type === "fillin") {
        q.gapEls = Array.from(document.querySelectorAll('[class*="options-dropdown"]'));
        // стабильный текст: dropdown'ы -> "___", иначе твой выбор меняет подпись и запускает заново
        const clone = qEl.cloneNode(true);
        clone.querySelectorAll('[class*="dropdown-wrapper"]').forEach((d) => d.replaceWith(document.createTextNode(" ___ ")));
        q.question = norm(clone.textContent).replace(/^Question text:\s*/i, "");
        q.template = q.question;
      }
      return q;
    },

    highlight(index, confidence) {
      const el = document.querySelectorAll(this.SEL_OPTION)[index];
      if (!el) { console.warn(TAG, "вариант #" + index + " не найден"); return; }
      styleHighlight(this._hls, el, confidence);
    },
    highlightEl(el, confidence) { styleHighlight(this._hls, el, confidence); },
    clearHighlight() { styleClear(this._hls); },

    // Quizizz dropdown: клик по кнопке -> варианты в v-popper -> собрать -> закрыть (клик снова).
    collectGapOptions(gapEls) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      return (async () => {
        const out = [];
        for (const btn of gapEls) {
          try {
            btn.click();
            await wait(320);
            let opts = Array.from(document.querySelectorAll('[role="option"], [class*="dropdown-option"], [class*="option-item"]'))
              .map((e) => norm(e.textContent))
              .filter((t) => t && !/выберите ответ|select an answer/i.test(t));
            opts = opts.filter((v, i, a) => a.indexOf(v) === i);
            out.push(opts);
            btn.click(); // закрыть
            await wait(150);
          } catch (e) { out.push([]); }
        }
        return out;
      })();
    },
  };

  // Edpuzzle - НЕ игра, а видео-задания. Их API сам отдаёт правильные ответы (choice.isCorrect).
  // Gemini не нужен. Два режима: highlight (подсветить/показать) и auto (сабмит + скип видео).
  const edpuzzleAdapter = {
    name: "edpuzzle",
    matches: (h) => h.includes("edpuzzle.com"),
    base: "https://edpuzzle.com",
    _hls: [],
    _correct: null,
    _edMo: null,
    csrf: null,
    mode: null, // legacy | new
    assignment: null,
    media: null,
    questions: null,

    text(body) {
      if (!body) return "";
      if (typeof body === "string") return norm(body.replace(/<[^>]+>/g, " "));
      if (Array.isArray(body)) return norm(body.map((b) => b.text || b.html || "").join(" ").replace(/<[^>]+>/g, " "));
      if (body.text || body.html) return norm(String(body.text || body.html).replace(/<[^>]+>/g, " "));
      return "";
    },
    assignmentId() { const m = location.pathname.match(/\/assignments\/([a-f0-9]+)/i); return m ? m[1] : null; },
    attachmentId() { return new URLSearchParams(location.search).get("attachmentId"); },
    version() { try { return (window.edpuzzle_data && window.edpuzzle_data.version) || (window.EDPUZZLE_DATA && window.EDPUZZLE_DATA.version) || null; } catch (e) { return null; } },
    async getCsrf() {
      if (this.csrf) return this.csrf;
      try { const r = await fetch(this.base + "/api/v3/csrf", { credentials: "include" }); const d = await r.json(); this.csrf = d.CSRFToken; } catch (e) {}
      return this.csrf;
    },
    async headers() {
      const h = { accept: "application/json, text/plain, */*", "content-type": "application/json", "x-edpuzzle-referrer": location.href };
      const c = await this.getCsrf(); if (c) h["x-csrf-token"] = c;
      const v = this.version(); if (v) h["x-edpuzzle-web-version"] = v;
      return h;
    },
    async jget(url) { const r = await fetch(url, { credentials: "include", headers: await this.headers() }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }; },
    async jpost(url, body) { const r = await fetch(url, { method: "POST", credentials: "include", headers: await this.headers(), body: JSON.stringify(body) }); return { ok: r.ok, status: r.status }; },

    async loadAssignment() {
      const id = this.assignmentId();
      if (!id) throw new Error("нет assignment id в URL (открой /assignments/{id}/watch)");
      let res = await this.jget(this.base + "/api/v3/assignments/" + id);
      if (res.ok) { this.mode = "legacy"; this.assignment = res.data; return; }
      this.mode = "new";
      const me = await this.jget(this.base + "/api/v3/users/me");
      const uid = me.data && me.data._id;
      res = await this.jget(this.base + "/api/v3/learning/assignments/" + id + "/users/" + uid);
      if (!res.ok) throw new Error("assignment fetch " + res.status);
      this.assignment = res.data;
    },
    mediaId() {
      if (this.mode === "new") {
        const att = this.attachmentId();
        const f = ((this.assignment.assignment && this.assignment.assignment.attachments) || []).filter((a) => a.id == att)[0];
        return f && f.contentId;
      }
      return this.assignment.teacherAssignments[0].contentId;
    },
    async loadMedia() {
      const mid = this.mediaId();
      if (!mid) throw new Error("не нашёл media id (нужен attachmentId в URL?)");
      const res = await this.jget(this.base + "/api/media/" + mid);
      this.media = res.data;
      this.questions = (res.data && res.data.questions) || [];
      return this.questions;
    },
    async getAttempt() {
      const id = this.assignmentId();
      if (this.mode === "new") {
        const att = this.attachmentId();
        const subs = (this.assignment.assignmentLearner && this.assignment.assignmentLearner.submissions) || [];
        const f = subs.filter((s) => s.attachmentId == att)[0];
        const res = await this.jget(this.base + "/api/v3/learning/submissions/" + f.id);
        return res.data;
      }
      const res = await this.jget(this.base + "/api/v3/assignments/" + id + "/attempt");
      return res.data;
    },

    async autoSubmit(mc) {
      setIndicator("Edpuzzle: отправляю ответы...", "#3b82f6");
      const attempt = await this.getAttempt();
      const attId = attempt._id || attempt.id;
      let url, body;
      if (this.mode === "new") {
        url = this.base + "/api/v3/learning/submissions/" + attId + "/answers";
        body = { answerQuestions: mc.map((q) => ({ questionData: { choiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c._id) }, questionId: q._id, questionType: "multiple-choice" })), answerSaveStatus: "answered" };
      } else {
        url = this.base + "/api/v3/attempts/" + attId + "/answers";
        body = { answers: mc.map((q) => ({ questionId: q._id, choices: q.choices.filter((c) => c.isCorrect).map((c) => c._id), type: "multiple-choice" })) };
      }
      const r = await this.jpost(url, body);
      await this.skipVideo(attempt);
      const ok = r.ok;
      console.log(TAG, "Edpuzzle авто: сабмит " + (ok ? "ok" : "FAIL " + r.status) + " + скип видео");
      setIndicator(ok ? "Edpuzzle: ответы отправлены + видео пропущено (F5)" : "Edpuzzle: ошибка сабмита " + r.status, ok ? "#22c55e" : "#ef4444");
    },
    async skipVideo(attempt) {
      const id = attempt._id || attempt.id;
      const url = this.mode === "new"
        ? this.base + "/api/v3/learning/time_intervals/submission/" + id + "/watch"
        : this.base + "/api/v4/media_attempts/" + id + "/watch";
      try { await this.jpost(url, { timeIntervalNumber: 10 }); } catch (e) {}
    },

    highlightMode(mc) {
      this._correct = new Set();
      mc.forEach((q) => q.choices.filter((c) => c.isCorrect).forEach((c) => { const t = this.text(c.body).toLowerCase(); if (t) this._correct.add(t); }));
      const lines = mc.map((q, i) => "Q" + (i + 1) + ": " + q.choices.filter((c) => c.isCorrect).map((c) => this.text(c.body)).join(" | "));
      showAnswer("Edpuzzle - правильные ответы:\n" + lines.join("\n"));
      setIndicator("Edpuzzle: " + mc.length + " ответов готовы - см. оверлей", "#22c55e");
      const scan = () => {
        document.querySelectorAll('[class*="choice"],[class*="option"],[class*="answer"],label,button').forEach((el) => {
          if (el.__edHl || el.children.length > 3) return;
          const t = norm(el.textContent).toLowerCase();
          if (!t) return;
          let hit = this._correct.has(t);
          if (!hit) this._correct.forEach((c) => { if (c.length > 3 && (t === c || t.endsWith(c) || t.includes(c))) hit = true; });
          if (hit) { el.__edHl = true; styleHighlight(this._hls, el, 1); }
        });
      };
      this._edMo = new MutationObserver(scan);
      this._edMo.observe(document.body, { childList: true, subtree: true });
      scan();
    },

    async run(mode) {
      setIndicator("Edpuzzle: читаю задание...", "#3b82f6");
      await this.loadAssignment();
      await this.loadMedia();
      const mc = this.questions.filter((q) => q.type === "multiple-choice");
      console.log(TAG, "Edpuzzle:", this.questions.length, "вопросов,", mc.length, "мультивыбор, режим", this.mode);
      const open = this.questions.filter((q) => q.type !== "multiple-choice").length;
      if (open) console.log(TAG, "Edpuzzle: открытых", open, "(в API без ответа, пропускаю)");
      if (!mc.length) { setIndicator("Edpuzzle: нет мультивыбора в API", "#f59e0b"); return; }
      if (mode === "auto") await this.autoSubmit(mc);
      else this.highlightMode(mc);
    },
    cleanup() { try { this._edMo && this._edMo.disconnect(); } catch (e) {} styleClear(this._hls); },
  };

  // Wordwall - игра на canvas (текста в DOM нет), но модель с ответами лежит в content-models JSON,
  // а результат сервер принимает от клиента без валидации (score/correct/time шлём сами) -> авто-сабмит.
  const wordwallAdapter = {
    name: "wordwall",
    matches: (h) => h.includes("wordwall.net"),

    async fetchModel(url) {
      const r = await fetch(url, { credentials: "omit" });
      try { return await r.clone().json(); }
      catch (e) {
        const buf = await r.arrayBuffer();
        const ds = new DecompressionStream("gzip");
        const txt = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
        return JSON.parse(txt);
      }
    },
    genGuid() { return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16); }); },

    _waitTimer: null,
    ready() {
      var pd = window.pageData;
      if (!(pd && pd.homeworkGameId && pd.activityGuid)) return false;
      if (!document.querySelector("canvas.render-canvas") && !document.querySelector("canvas.js-render-canvas")) return false;
      // экран старта: видна кнопка "Почати" (join) -> тест ещё не начат
      var join = document.querySelector(".js-join-button, .join-game");
      if (join && join.offsetParent !== null) return false;
      return true;
    },
    // клик на экране имени -> ждём загрузки теста -> шлём сабмит со свежим временем/режимом
    armAndRun() {
      var self = this;
      var fire = function () {
        store.get(["wwTime", "wwMode"]).then(function (c) { self.run(c.wwTime || 800, c.wwMode || "server"); });
      };
      if (this.ready()) { fire(); return; }
      setIndicator("Wordwall: жду тест...", "#3b82f6");
      this._waitTimer = setInterval(function () {
        if (self.ready()) { clearInterval(self._waitTimer); self._waitTimer = null; fire(); }
      }, 1000);
    },

    countItems(content) {
      var max = 0;
      for (var k in content) if (content.hasOwnProperty(k) && Array.isArray(content[k]) && content[k].length > max) max = content[k].length;
      return max;
    },
    describe(content) {
      var o = {};
      for (var k in content) {
        if (!content.hasOwnProperty(k)) continue;
        var v = content[k];
        if (Array.isArray(v)) o[k] = "array[" + v.length + "] " + JSON.stringify(v[0] || null).slice(0, 160);
        else if (v && typeof v === "object") o[k] = "obj " + JSON.stringify(v).slice(0, 100);
        else o[k] = String(v).slice(0, 60);
      }
      return o;
    },

    async run(timeMs, mode) {
      const pd = window.pageData || {};
      if (!pd.homeworkGameId) { setIndicator("Wordwall: нет id активности (не тот тип ссылки)", "#f59e0b"); return; }
      setIndicator("Wordwall: читаю модель...", "#3b82f6");
      const modelUrl = "https://user.cdn.wordwall.net/content-models/" + pd.authorUserId + "/" + pd.activityGuid + ".json";
      let model;
      try { model = await this.fetchModel(modelUrl); }
      catch (e) { setIndicator("Wordwall: модель не достал: " + e.message, "#ef4444"); return; }
      const content = (model && model.content) || {};
      const n = this.countItems(content);
      this._diag = { templateId: pd.templateId, type: model && model.type, count: n, content: this.describe(content),
        pageData: { homeworkGameId: pd.homeworkGameId, activityGuid: pd.activityGuid, authorUserId: pd.authorUserId, templateId: pd.templateId } };
      if (!n) { setIndicator("Wordwall: не нашёл элементы (шаблон " + pd.templateId + ") - жми «Копировать дамп»", "#f59e0b"); console.log(TAG, "WW diag:", this._diag); return; }
      if (mode === "canvas") return this.runCanvas(content, timeMs || 800);
      return this.runServer(pd, n, timeMs || 800);
    },

    async runServer(pd, n, time) {
      const guid = localStorage.getItem("user_guid") || this.genGuid();
      const forename = localStorage.getItem("user_forename") || "1";
      const surname = localStorage.getItem("user_surname") || "";
      // ответ вопроса i = метка i (пин и метка спарены по индексу в модели)
      const answers = [];
      for (let i = 0; i < n; i++) answers.push({ question: i, givenAnswer: String(i), correct: true, timing: Math.round(time * (i + 1) / n), score: 1, excludeFromFinalScore: false });
      const body = { reference: null, player: { id: 0, forename: forename, surname: surname, guid: guid }, answers: answers, submissionId: 0, time: null, deleted: false, scoreOffset: 0, googleClassroomStudentSubmissionId: null };
      const url = "/MyResultsAjax/AddHomeworkSubmission?homeworkGameId=" + pd.homeworkGameId +
        "&name=" + encodeURIComponent(forename) + "&score=" + n + "&time=" + time + "&playerGuid=" + guid;
      setIndicator("Wordwall: отправляю результат (" + n + "/" + n + ")...", "#3b82f6");
      try {
        const r = await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const txt = await r.text().catch(function () { return ""; });
        this._diag = Object.assign(this._diag || {}, { submitUrl: url, submitBody: body, status: r.status, resp: txt.slice(0, 400) });
        console.log(TAG, "WW forge шаблон=" + pd.templateId + " n=" + n + " статус=" + r.status + " resp=" + txt.slice(0, 150));
        console.log(TAG, "WW diag (кнопка «Копировать дамп» в меню -> пришли мне):", this._diag);
        setIndicator(r.ok ? ("Wordwall: " + n + "/" + n + " отправлено (" + time + "мс) - открой лидерборд") : ("Wordwall: ошибка " + r.status + " - жми «Копировать дамп»"), r.ok ? "#22c55e" : "#ef4444");
      } catch (e) { setIndicator("Wordwall: сабмит упал: " + e.message, "#ef4444"); console.warn(TAG, "Wordwall submit err", e); }
    },

    async runCanvas(content, time) {
      // прохождение через сам движок (симуляция перетаскиваний по canvas) - в разработке
      setIndicator("Wordwall: канвас-режим ещё не готов", "#f59e0b");
      console.log(TAG, "Wordwall canvas-режим: заглушка, элементов " + this.countItems(content) + ", time " + time + "мс");
    },
  };

  const adapters = [kahootAdapter, classtimeAdapter, quizizzAdapter, edpuzzleAdapter, wordwallAdapter];
  const adapter = adapters.find((a) => a.matches(location.hostname));
  if (!adapter) {
    console.log(TAG, "сайт не поддержан:", location.hostname);
    setIndicator("сайт не поддержан", "#ef4444");
    return;
  }
  console.log(TAG, "загружен, адаптер:", adapter.name, "-", location.href);

  function collectGapOptions(gapEls) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    return (async () => {
      const out = [];
      for (const btn of gapEls) {
        try {
          btn.click();
          await wait(300);
          let opts = Array.from(document.querySelectorAll('[role="option"]'))
            .map((e) => norm(e.textContent)).filter(Boolean);
          if (!opts.length) {
            opts = Array.from(document.querySelectorAll('[class*="MenuItem"], [role="menuitem"]'))
              .map((e) => norm(e.textContent)).filter(Boolean);
          }
          out.push(opts);
          const backdrop = document.querySelector(".MuiBackdrop-root");
          if (backdrop) backdrop.click();
          else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await wait(200);
        } catch (e) { out.push([]); }
      }
      return out;
    })();
  }

  // ================= Gemini =================
  const GEMINI_MODEL = "gemini-3.1-flash-lite";
  const LANG_NAME = { ru: "Russian", uk: "Ukrainian", en: "English" };

  const GEMINI_SYSTEM =
    "You are a quiz assistant. You get a multiple-choice question and its options as text. " +
    "The question may include an image (e.g. a data table or diagram) - read it and use it. " +
    "Some options contain math in LaTeX (inside $...$). Interpret the LaTeX correctly. " +
    "Pick the single best answer. Read carefully: watch for negations (NOT, EXCEPT), 'all of the above', and trick wording. " +
    "Return ONLY a JSON object, no markdown. " +
    "correct_index is the 0-based index of the correct option in the given options array. " +
    "confidence is your confidence from 0.0 to 1.0.";
  const GEMINI_SCHEMA = {
    type: "OBJECT",
    properties: { correct_index: { type: "INTEGER" }, confidence: { type: "NUMBER" } },
    required: ["correct_index", "confidence"], propertyOrdering: ["correct_index", "confidence"],
  };

  const GEMINI_SYSTEM_MULTI =
    "You are a quiz assistant. This is a multiple-choice question where MORE THAN ONE option can be correct. " +
    "The question may include an image - read it and use it. Options are given as text. " +
    "Select ALL correct options (the question often says how many, e.g. 'select two'). " +
    "Return ONLY a JSON object, no markdown. " +
    "correct_indices is an array of the 0-based indices of ALL correct options. confidence is 0.0 to 1.0.";
  const GEMINI_SCHEMA_MULTI = {
    type: "OBJECT",
    properties: { correct_indices: { type: "ARRAY", items: { type: "INTEGER" } }, confidence: { type: "NUMBER" } },
    required: ["correct_indices", "confidence"], propertyOrdering: ["correct_indices", "confidence"],
  };

  const GEMINI_SYSTEM_MATRIX =
    "You are a quiz assistant. You get a question and a list of rows (statements/evidence). " +
    "The question may include an image - read it and use it. " +
    "For EACH row decide Yes (true) or No (false) according to the question. " +
    "Return ONLY a JSON object, no markdown. " +
    "answers is an array of booleans, one per row IN THE SAME ORDER (true = Yes, false = No). confidence is 0.0 to 1.0.";
  const GEMINI_SCHEMA_MATRIX = {
    type: "OBJECT",
    properties: { answers: { type: "ARRAY", items: { type: "BOOLEAN" } }, confidence: { type: "NUMBER" } },
    required: ["answers", "confidence"], propertyOrdering: ["answers", "confidence"],
  };

  const GEMINI_SYSTEM_OPEN =
    "You are a quiz assistant for an open-ended (write-in) question. " +
    "The question may include an image - read it and use it. " +
    "Give a concise, correct answer that would earn full marks. " +
    "If the question asks to use N pieces of evidence, include them. " +
    "Return ONLY a JSON object, no markdown. answer is the answer text. confidence is 0.0 to 1.0.";
  const GEMINI_SCHEMA_OPEN = {
    type: "OBJECT",
    properties: { answer: { type: "STRING" }, confidence: { type: "NUMBER" } },
    required: ["answer", "confidence"], propertyOrdering: ["answer", "confidence"],
  };

  const GEMINI_SYSTEM_FIBBOX =
    "You are a quiz assistant for a fill-in-the-blank question with N typed input boxes inside the sentence. " +
    "Read the reading passage in 'passage' if provided - the answer usually comes from it. " +
    "Return ONLY a JSON object, no markdown. values is an array with EXACTLY one entry per box, in left-to-right order - " +
    "each is ONLY the value to type (a number, word, or symbol), NO extra words. confidence 0.0 to 1.0.";
  const GEMINI_SCHEMA_FIBBOX = {
    type: "OBJECT",
    properties: { values: { type: "ARRAY", items: { type: "STRING" } }, confidence: { type: "NUMBER" } },
    required: ["values", "confidence"], propertyOrdering: ["values", "confidence"],
  };

  const GEMINI_SYSTEM_CATGRID =
    "You are a quiz assistant for a categorizer question with checkboxes: a table where each ROW is an item and each COLUMN is a category. " +
    "An item can belong to MULTIPLE categories. You get 'items' (rows in order) and 'categories' (columns in order). " +
    "For EACH item IN ORDER, return the list of 0-based category indices that apply to it. " +
    "Return ONLY a JSON object, no markdown. rows is an array (one per item in order), each {categories: [indices]}. confidence 0.0 to 1.0.";
  const GEMINI_SCHEMA_CATGRID = {
    type: "OBJECT",
    properties: {
      rows: { type: "ARRAY", items: { type: "OBJECT", properties: { categories: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["categories"] } },
      confidence: { type: "NUMBER" },
    },
    required: ["rows", "confidence"], propertyOrdering: ["rows", "confidence"],
  };

  const GEMINI_SYSTEM_HOTSPOT =
    "You are a quiz assistant for a click-on-image (hotspot) question - the student must click the correct point on a picture. " +
    "You may get the image. Identify the target named in the question and describe WHERE it is in plain spatial words " +
    "(e.g. 'top-center', 'the large vessel arching at the very top', 'upper-left chamber'). Use real-world knowledge (anatomy, maps, etc). " +
    "Return ONLY a JSON object, no markdown. answer is a short description of WHERE to click. confidence 0.0 to 1.0.";

  const GEMINI_SYSTEM_DRAW =
    "You are a quiz assistant for a draw/trace question - the student draws BY HAND on a diagram or map. " +
    "You get the instruction. For EACH thing to draw, give ONE short plain-language line: what to draw, its color if specified, " +
    "and WHERE on the image using simple spatial words (e.g. 'horizontal line straight across the middle', 'vertical line down through the center'). " +
    "Use real-world knowledge (geography, etc). Return ONLY a JSON object, no markdown. answer is the guidance text, one line per item. confidence 0.0 to 1.0.";

  const GEMINI_SYSTEM_MATHINPUT =
    "You are a quiz assistant for a math question answered by typing into a math input field. " +
    "The question may include an image or fractions - read them. Solve it. " +
    "Return ONLY a JSON object, no markdown. answer is ONLY the final value - a number, fraction (e.g. 1/4), decimal, or expression - " +
    "with NO words, NO sentences, NO units unless the question explicitly needs them. confidence is 0.0 to 1.0.";

  const GEMINI_SYSTEM_FILLIN =
    "You are a quiz assistant for a fill-in-the-blank question with dropdowns. " +
    "You get the question, a sentence template with numbered blanks, and for each blank (gap) IN ORDER its list of options. " +
    "The question may include an image - read it. Choose the best option for EACH gap from ITS OWN options list. " +
    "Return ONLY a JSON object, no markdown. gaps is an array (one per blank in order), each with " +
    "choice_index = 0-based index into that gap's options. confidence is 0.0 to 1.0.";
  const GEMINI_SCHEMA_FILLIN = {
    type: "OBJECT",
    properties: {
      gaps: { type: "ARRAY", items: { type: "OBJECT", properties: { choice_index: { type: "INTEGER" } }, required: ["choice_index"] } },
      confidence: { type: "NUMBER" },
    },
    required: ["gaps", "confidence"], propertyOrdering: ["gaps", "confidence"],
  };

  const GEMINI_SYSTEM_HIGHLIGHT =
    "You are a quiz assistant. The question asks to select the words/phrases (segments) in the text that satisfy it. " +
    "You get the question, the reading passage in 'passage', and a list of selectable segments in order. " +
    "Some questions have several correct segments, some have none. " +
    "Return ONLY a JSON object, no markdown. correct_indices is an array of the 0-based indices of the segments to select " +
    "(empty array if none apply). confidence is 0.0 to 1.0.";

  const GEMINI_SYSTEM_SORT =
    "You are a quiz assistant for an ordering question. You get the question and a list of items in their CURRENT order. " +
    "The question may include an image (e.g. graphs) - read it and use it. " +
    "Reorder the items into the CORRECT sequence per the question. " +
    "Return ONLY a JSON object, no markdown. order is an array of the item texts in the correct order " +
    "(first element = position 1). Use the exact item texts you were given. confidence is 0.0 to 1.0.";
  const GEMINI_SCHEMA_SORT = {
    type: "OBJECT",
    properties: { order: { type: "ARRAY", items: { type: "STRING" } }, confidence: { type: "NUMBER" } },
    required: ["order", "confidence"], propertyOrdering: ["order", "confidence"],
  };

  const GEMINI_SYSTEM_MATCH =
    "You are a quiz assistant for a matching question. You get 'prompts' (e.g. descriptions) and 'answers' (e.g. terms). " +
    "For EACH prompt IN ORDER, pick the answer that matches it. " +
    "Return ONLY a JSON object, no markdown. matches is an array (one per prompt in order) of the 0-based index into the answers list. confidence 0.0 to 1.0.";
  const GEMINI_SCHEMA_MATCH = {
    type: "OBJECT",
    properties: { matches: { type: "ARRAY", items: { type: "INTEGER" } }, confidence: { type: "NUMBER" } },
    required: ["matches", "confidence"], propertyOrdering: ["matches", "confidence"],
  };

  const GEMINI_SYSTEM_DRAGFILL =
    "You are a quiz assistant. The student drags tiles into labeled blanks inside the question. " +
    "You get the question text (which may require solving, e.g. math), the ordered list of blank labels in 'blanks', " +
    "and the pool of available tiles in 'tiles'. Solve the question as needed, then for EACH blank IN ORDER pick the tile that fills it. " +
    "Each tile is used at most once. " +
    "Return ONLY a JSON object, no markdown. matches is an array (one per blank in order) of the 0-based index into 'tiles'. confidence 0.0 to 1.0.";

  const GEMINI_SYSTEM_GRAPH =
    "You are a quiz assistant for a graphing question (plot a line/function on a coordinate grid by placing points). " +
    "The user does NOT know math - explain simply. Give 2-3 exact integer points on the required graph. " +
    "For EACH point, 'howto' must be a DEAD-SIMPLE plain-language instruction where to click on the grid, treating the center as (0,0), " +
    "e.g. 'from the center: 1 square right, 4 squares up' or 'from the center: 3 squares left, 2 squares down' (if a coordinate is 0, say 'stay' for that direction). " +
    "Return ONLY a JSON object, no markdown. points is an array of {x, y, howto}. confidence 0.0 to 1.0.";
  const GEMINI_SCHEMA_GRAPH = {
    type: "OBJECT",
    properties: {
      points: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" }, howto: { type: "STRING" } }, required: ["x", "y", "howto"] },
      },
      confidence: { type: "NUMBER" },
    },
    required: ["points", "confidence"], propertyOrdering: ["points", "confidence"],
  };

  const GEMINI_SYSTEM_LABEL =
    "You are a quiz assistant for a label-the-diagram question. The image shows a diagram with empty spots to place labels. " +
    "You get the list of labels. For EACH label, describe in a few words WHERE on the diagram it belongs, " +
    "referencing visible features (e.g. 'near the clouds', 'at the bottom by the water', 'the upward arrow from the sea'). " +
    "Return ONLY a JSON object, no markdown. placements is an array with one entry per label: {label, where}. confidence 0.0 to 1.0.";
  const GEMINI_SCHEMA_LABEL = {
    type: "OBJECT",
    properties: {
      placements: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { label: { type: "STRING" }, where: { type: "STRING" } }, required: ["label", "where"] },
      },
      confidence: { type: "NUMBER" },
    },
    required: ["placements", "confidence"], propertyOrdering: ["placements", "confidence"],
  };

  const GEMINI_SYSTEM_CATEGORIZE =
    "You are a quiz assistant for a categorization / drag-and-drop question. " +
    "You get the question and a list of categories (in order). The options are provided as IMAGES, in order, after the JSON text. " +
    "Assign EACH option image to the single best category. " +
    "Return ONLY a JSON object, no markdown. assignments is an array with one entry per option IN THE SAME ORDER as the images, " +
    "each entry being the 0-based index into the categories list. confidence is 0.0 to 1.0.";
  const GEMINI_SCHEMA_CATEGORIZE = {
    type: "OBJECT",
    properties: { assignments: { type: "ARRAY", items: { type: "INTEGER" } }, confidence: { type: "NUMBER" } },
    required: ["assignments", "confidence"], propertyOrdering: ["assignments", "confidence"],
  };

  async function postGemini(key, systemText, parts, schema) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + key;
    const body = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    };
    const t0 = performance.now();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      const emsg = (json.error && json.error.message) || "HTTP " + res.status;
      if (res.status === 429) {
        store.set({ limitMsg: "Лимит исчерпан (429). RPD сбросится в полночь по PT." });
        setIndicator("лимит исчерпан", "#eab308");
      } else if (res.status === 403 || /api.?key|api_key_invalid|not valid/i.test(emsg)) {
        store.set({ authMsg: "Ключ неверный или нет доступа к API." });
        setIndicator("ключ неверный", "#ef4444");
      } else {
        setIndicator("ошибка API", "#ef4444");
      }
      console.error(TAG, "Gemini ошибка", res.status, emsg);
      return null;
    }
    const used = (json.usageMetadata && json.usageMetadata.totalTokenCount) || 0;
    const raw = json && json.candidates && json.candidates[0].content.parts[0].text;
    const cur = await store.get("tokensUsed");
    store.set({ tokensUsed: (cur.tokensUsed || 0) + used, limitMsg: "", authMsg: "" });
    return { ans: JSON.parse(raw), used: used, ms: ms };
  }

  async function ask(q, sig) {
    if (busy) return;
    busy = true;
    try { await _ask(q, sig); } finally { busy = false; }
  }

  async function _ask(q, sig) {
    const cfg = await store.get(["geminiKey", "enabled", "textOnly", "lang"]);
    if (cfg.enabled === false) { setIndicator("выключено", "#555"); return; }
    const key = cfg.geminiKey;
    if (!key) {
      console.warn(TAG, "нет ключа Gemini - вставь его в меню (кнопка ⚙ TH справа сверху)");
      setIndicator("нет ключа - открой меню ⚙", "#f59e0b");
      return;
    }

    const sk = getSessionKey();
    if (sk !== sessionKey) { sessionKey = sk; history = []; console.log(TAG, "новый тест:", sk); }

    const type = q.type;
    let userObj, systemText, schema, gapOptions = null;
    if (type === "fillin") {
      setIndicator("читаю варианты...", "#3b82f6");
      gapOptions = await (adapter.collectGapOptions ? adapter.collectGapOptions(q.gapEls) : collectGapOptions(q.gapEls));
      userObj = { question: q.question, template: q.template, gaps: gapOptions.map((o) => ({ options: o })) };
      systemText = GEMINI_SYSTEM_FILLIN; schema = GEMINI_SCHEMA_FILLIN;
    } else if (type === "sort") {
      userObj = { question: q.question, items: q.items };
      systemText = GEMINI_SYSTEM_SORT; schema = GEMINI_SCHEMA_SORT;
    } else if (type === "highlight") {
      userObj = { question: q.question, segments: q.options.map((o) => o.text) };
      systemText = GEMINI_SYSTEM_HIGHLIGHT; schema = GEMINI_SCHEMA_MULTI;
    } else if (type === "categorize") {
      userObj = { question: q.question, categories: q.categories };
      systemText = GEMINI_SYSTEM_CATEGORIZE; schema = GEMINI_SCHEMA_CATEGORIZE;
    } else if (type === "label") {
      userObj = { question: q.question, labels: q.labels };
      systemText = GEMINI_SYSTEM_LABEL; schema = GEMINI_SCHEMA_LABEL;
    } else if (type === "graph") {
      userObj = { question: q.question };
      systemText = GEMINI_SYSTEM_GRAPH; schema = GEMINI_SCHEMA_GRAPH;
    } else if (type === "match") {
      userObj = { question: q.question, prompts: q.prompts, answers: q.answers };
      systemText = GEMINI_SYSTEM_MATCH; schema = GEMINI_SCHEMA_MATCH;
    } else if (type === "dragfill") {
      userObj = { question: q.question, blanks: q.prompts, tiles: q.tiles };
      systemText = GEMINI_SYSTEM_DRAGFILL; schema = GEMINI_SCHEMA_MATCH;
    } else if (type === "fibbox") {
      userObj = { question: q.question, boxes: q.boxCount };
      systemText = GEMINI_SYSTEM_FIBBOX; schema = GEMINI_SCHEMA_FIBBOX;
    } else if (type === "catgrid") {
      userObj = { question: q.question, items: q.items, categories: q.categories };
      systemText = GEMINI_SYSTEM_CATGRID; schema = GEMINI_SCHEMA_CATGRID;
    } else if (type === "hotspot") {
      userObj = { question: q.question };
      systemText = GEMINI_SYSTEM_HOTSPOT; schema = GEMINI_SCHEMA_OPEN;
    } else if (type === "draw") {
      userObj = { question: q.question };
      systemText = GEMINI_SYSTEM_DRAW; schema = GEMINI_SCHEMA_OPEN;
    } else if (type === "mathinput") {
      userObj = { question: q.question };
      systemText = GEMINI_SYSTEM_MATHINPUT; schema = GEMINI_SCHEMA_OPEN;
    } else if (type === "open" || type === "voice") {
      userObj = { question: q.question };
      systemText = GEMINI_SYSTEM_OPEN; schema = GEMINI_SCHEMA_OPEN;
    } else if (type === "matrix") {
      userObj = { question: q.question, rows: q.rows.map((r) => r.text) };
      systemText = GEMINI_SYSTEM_MATRIX; schema = GEMINI_SCHEMA_MATRIX;
    } else if (type === "multi") {
      userObj = { question: q.question, options: q.options.map((o) => o.text) };
      systemText = GEMINI_SYSTEM_MULTI; schema = GEMINI_SCHEMA_MULTI;
    } else {
      userObj = { question: q.question, options: q.options.map((o) => o.text) };
      systemText = GEMINI_SYSTEM; schema = GEMINI_SCHEMA;
    }

    if (q.passage) {
      systemText += " A reading passage is provided in the 'passage' field - base your answer strictly on it.";
      userObj.passage = q.passage;
    }
    if (history.length) {
      userObj.history = history.slice(-8);
      systemText += " 'history' has earlier questions in this test with your answers - some questions reference previous parts (e.g. 'your answer in Part A'), use it.";
    }

    console.log(TAG, "📋 контекст -> тест:", sessionKey,
      "| passage:", q.passage ? q.passage.length + " симв" : "нет",
      "| история:", (userObj.history ? userObj.history.length : 0) + " вопр");
    if (userObj.history) {
      userObj.history.forEach((h, i) =>
        console.log(TAG, "   история[" + i + "] " + h.type + ": «" + h.q.slice(0, 60) + "» => «" + String(h.a).slice(0, 60) + "»"));
    }

    const lang = cfg.lang || "ru";
    systemText += " Respond in " + (LANG_NAME[lang] || "Russian") + ".";

    const parts = [{ text: JSON.stringify(userObj) }];
    if (!cfg.textOnly && (q.imageUrl || q.audioUrl)) {
      setIndicator(q.audioUrl ? "слушаю аудио..." : "смотрю картинку...", "#3b82f6");
      if (q.imageUrl) {
        try { const img = await fetchMediaBase64(q.imageUrl); parts.push({ inline_data: { mime_type: img.mime, data: img.b64 } }); }
        catch (e) { console.warn(TAG, "картинку не достал:", e.message); }
      }
      if (q.audioUrl) {
        try { const au = await fetchMediaBase64(q.audioUrl); const m = /^audio\//.test(au.mime) ? au.mime : "audio/mpeg"; parts.push({ inline_data: { mime_type: m, data: au.b64 } }); }
        catch (e) { console.warn(TAG, "аудио не достал:", e.message); }
      }
    } else {
      setIndicator("думаю...", "#3b82f6");
    }

    // categorize: приложить картинки опций (vision), по порядку
    if (type === "categorize" && !cfg.textOnly && q.optItems) {
      setIndicator("смотрю картинки...", "#3b82f6");
      for (const it of q.optItems) {
        if (it.imageUrl) {
          try {
            const im = await fetchMediaBase64(it.imageUrl);
            parts.push({ inline_data: { mime_type: im.mime, data: im.b64 } });
          } catch (e) {
            console.warn(TAG, "картинку опции не достал:", e.message);
          }
        }
      }
    }

    let r;
    try { r = await postGemini(key, systemText, parts, schema); }
    catch (e) { console.error(TAG, "Gemini исключение:", e.message); setIndicator("ошибка сети", "#ef4444"); return; }
    if (!r) return;

    if (sig !== lastSig) { console.log(TAG, "вопрос сменился - подсветку пропускаю"); return; }

    const color = r.ans.confidence >= 0.8 ? "#22c55e" : "#eab308";
    let summary = "";

    if (type === "fillin") {
      const arr = Array.isArray(r.ans.gaps) ? r.ans.gaps : [];
      const lines = arr.map((g, i) => {
        const opts = gapOptions[i] || [];
        const t = opts[g.choice_index] != null ? opts[g.choice_index] : "?";
        return "Пропуск " + (i + 1) + " -> " + t;
      });
      summary = lines.join("; ");
      console.log(TAG, "🤖 fill-in (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer(lines.join("\n"));
      setIndicator("ответ готов - см. оверлей", color);
    } else if (type === "sort") {
      const order = Array.isArray(r.ans.order) ? r.ans.order : [];
      const lines = order.map((t, i) => i + 1 + ". " + t);
      summary = lines.join("; ");
      console.log(TAG, "🤖 порядок (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Правильный порядок:\n" + lines.join("\n"));
      setIndicator("порядок готов - см. оверлей", color);
    } else if (type === "highlight") {
      const idxs = Array.isArray(r.ans.correct_indices) ? r.ans.correct_indices : [];
      idxs.forEach((i) => { if (q.segEls[i]) adapter.highlightEl(q.segEls[i], r.ans.confidence); });
      summary = idxs.map((i) => q.options[i] && q.options[i].text).join(" | ") || "нет";
      console.log(TAG, "🤖 выбор фраз [" + idxs.join(",") + "] (" + r.ms + "ms " + r.used + "tok): " + summary);
      setIndicator(idxs.length ? "выбрано [" + idxs.join(",") + "]" : "нет подходящих фраз", color);
    } else if (type === "categorize") {
      const asg = Array.isArray(r.ans.assignments) ? r.ans.assignments : [];
      const lines = asg.map((ci, i) => "Опция " + (i + 1) + " -> " + (q.categories[ci] != null ? q.categories[ci] : "?"));
      summary = lines.join("; ");
      console.log(TAG, "🤖 категории (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Разложить по категориям (опции в порядке слева):\n" + lines.join("\n"));
      setIndicator("категории готовы - см. оверлей", color);
    } else if (type === "label") {
      const pl = Array.isArray(r.ans.placements) ? r.ans.placements : [];
      const lines = pl.map((p) => "• " + p.label + " -> " + p.where);
      summary = lines.join("; ");
      console.log(TAG, "🤖 метки (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Метки (позиции ПРИМЕРНЫЕ, наводи по смыслу):\n" + lines.join("\n"));
      setIndicator("метки готовы - см. оверлей", color);
    } else if (type === "graph") {
      const pts = Array.isArray(r.ans.points) ? r.ans.points : [];
      const lines = pts.map((p, i) => "Точка " + (i + 1) + " (" + p.x + ", " + p.y + "): " + (p.howto || ""));
      summary = pts.map((p) => "(" + p.x + "," + p.y + ")").join(" ");
      console.log(TAG, "🤖 график (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Центр сетки = (0,0). Ставь точки так:\n" + lines.join("\n") + "\nПотом соедини их линией.");
      setIndicator("точки готовы - см. оверлей", color);
    } else if (type === "match") {
      const m = Array.isArray(r.ans.matches) ? r.ans.matches : [];
      const lines = m.map((ai, i) => "• " + (q.answers[ai] != null ? q.answers[ai] : "?") + "  =  " + String(q.prompts[i] || "").slice(0, 55));
      summary = lines.join("; ");
      console.log(TAG, "🤖 пары (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Пары (соедини термин с описанием):\n" + lines.join("\n"));
      setIndicator("пары готовы - см. оверлей", color);
    } else if (type === "dragfill") {
      const m = Array.isArray(r.ans.matches) ? r.ans.matches : [];
      const lines = m.map((ti, i) => "• " + String(q.prompts[i] || ("Пропуск " + (i + 1))).slice(0, 45) + " -> " + (q.tiles[ti] != null ? q.tiles[ti] : "?"));
      summary = lines.join("; ");
      console.log(TAG, "🤖 плитки (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Перетащи плитки в пропуски:\n" + lines.join("\n"));
      setIndicator("плитки готовы - см. оверлей", color);
    } else if (type === "fibbox") {
      const vals = Array.isArray(r.ans.values) ? r.ans.values : [];
      const lines = vals.map((v, i) => "Коробка " + (i + 1) + ": " + v);
      summary = vals.join(" | ");
      console.log(TAG, "🤖 впиши коробки (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Впиши по коробкам:\n" + lines.join("\n"));
      setIndicator("ответ готов - см. оверлей", color);
    } else if (type === "catgrid") {
      const rows = Array.isArray(r.ans.rows) ? r.ans.rows : [];
      const lines = rows.map((rr, i) => {
        const cats = (rr.categories || []);
        cats.forEach((ci) => { const box = q.catRows[i] && q.catRows[i].boxes[ci]; if (box) adapter.highlightEl(box.closest("td") || box, r.ans.confidence); });
        const names = cats.map((ci) => q.categories[ci]).filter(Boolean);
        return "• " + (q.items[i] || ("Позиция " + (i + 1))) + " -> " + (names.join(", ") || "нет");
      });
      summary = lines.join("; ");
      console.log(TAG, "🤖 категории-галочки (" + r.ms + "ms " + r.used + "tok):\n" + lines.join("\n"));
      showAnswer("Categorizer - отметь галочки:\n" + lines.join("\n"));
      setIndicator("категории готовы - см. оверлей", color);
    } else if (type === "hotspot" || type === "draw" || type === "mathinput" || type === "open" || type === "voice") {
      const text = r.ans.answer || "(пусто)";
      summary = text.slice(0, 200);
      console.log(TAG, "🤖 open-ответ (" + r.ms + "ms " + r.used + "tok):", text);
      showAnswer(text);
      setIndicator("ответ готов - см. оверлей", color);
    } else if (type === "matrix") {
      const arr = Array.isArray(r.ans.answers) ? r.ans.answers : [];
      const summ = [];
      q.rows.forEach((row, i) => {
        const yes = !!arr[i];
        const radio = yes ? row.yesEl : row.noEl;
        const target = radio ? radio.closest("td") || radio.closest("label") || radio : null;
        if (target) adapter.highlightEl(target, r.ans.confidence);
        summ.push(row.text.slice(0, 40) + " -> " + (yes ? "Yes" : "No"));
      });
      summary = summ.join("; ");
      console.log(TAG, "🤖 матрица (" + r.ms + "ms " + r.used + "tok):\n  " + summ.join("\n  "));
      setIndicator("матрица готова", color);
    } else if (type === "multi") {
      const idxs = Array.isArray(r.ans.correct_indices) ? r.ans.correct_indices : [];
      summary = idxs.map((i) => q.options[i] && q.options[i].text).join(" | ");
      console.log(TAG, "🤖 ответы [" + idxs.join(",") + "] «" + summary + "»  conf=" + r.ans.confidence + "  " + r.ms + "ms  " + r.used + "tok");
      idxs.forEach((i) => adapter.highlight(i, r.ans.confidence));
      setIndicator("ответы [" + idxs.join(",") + "]", color);
    } else {
      const i = r.ans.correct_index;
      summary = (q.options[i] && q.options[i].text) || "";
      console.log(TAG, "🤖 ответ [" + i + "] «" + summary + "»  conf=" + r.ans.confidence + "  " + r.ms + "ms  " + r.used + "tok");
      adapter.highlight(i, r.ans.confidence);
      setIndicator("ответ [" + i + "]", color);
    }

    history.push({ q: q.question.slice(0, 200), type: type, a: summary });
    if (history.length > 12) history.shift();
  }

  // ================= Ядро =================
  let lastSig = null;
  let sessionKey = null;
  let history = [];
  let busy = false;

  function getSessionKey() {
    const m = document.body.innerText.match(/(?:Session|Сесія|Сессия)\s+([A-Za-z0-9]{4,})/);
    if (m) return m[1];
    const t = document.querySelector('[class*="sessionTitle"], h1');
    return (t && norm(t.textContent)) || location.pathname;
  }

  const SUPPORTED = { single: 1, multi: 1, matrix: 1, open: 1, fillin: 1, sort: 1, highlight: 1, categorize: 1, label: 1, match: 1, dragfill: 1, voice: 1, mathinput: 1, draw: 1, fibbox: 1, hotspot: 1, catgrid: 1 };

  function isReady(q, type) {
    if (type === "matrix") return q.rows && q.rows.length >= 1;
    if (type === "fillin") return q.gapEls && q.gapEls.length >= 1;
    if (type === "sort") return q.items && q.items.length >= 2;
    if (type === "highlight") return q.segEls && q.segEls.length >= 1;
    if (type === "categorize") return q.optItems && q.optItems.length >= 1 && q.categories && q.categories.length >= 1;
    if (type === "label") return q.labels && q.labels.length >= 1;
    if (type === "match") return q.prompts && q.prompts.length >= 1 && q.answers && q.answers.length >= 1;
    if (type === "catgrid") return q.items && q.items.length >= 1 && q.categories && q.categories.length >= 1;
    if (type === "dragfill") return q.prompts && q.prompts.length >= 1 && q.tiles && q.tiles.length >= 2;
    if (type === "fibbox") return q.boxCount >= 1;
    if (type === "open" || type === "voice" || type === "mathinput" || type === "draw" || type === "hotspot" || type === "graph") return true;
    return q.options.length >= 2;
  }

  function tryLog() {
    if (busy) return;
    const q = adapter.readQuestion();
    if (!q) return;
    const type = q.type || "single";
    const supported = !!SUPPORTED[type];
    const sig = signature(q);
    if (sig === lastSig) return;
    if (supported && !isReady(q, type)) return;
    lastSig = sig;
    adapter.clearHighlight();
    hideAnswer();

    const media = (q.audioUrl ? " +аудио" : "") + (q.imageUrl ? " +картинка" : "");
    setTypeBadge((TYPE_NAME[type] || TYPE_LABEL[type] || type) + media);

    if (!supported) {
      console.log(TAG, "не мой формат:", type, "-", q.question);
      setIndicator("не мой формат: " + (TYPE_LABEL[type] || type), "#f59e0b");
      return;
    }

    if (type === "matrix") console.log(TAG, "матрица (" + q.rows.length + " строк):", q.question);
    else if (type === "fillin") console.log(TAG, "fill-in (" + q.gapEls.length + " пропусков):", q.question);
    else if (type === "sort") console.log(TAG, "упорядочивание (" + q.items.length + " элементов):", q.question);
    else if (type === "highlight") console.log(TAG, "выбор фраз (" + q.segEls.length + " сегментов):", q.question);
    else if (type === "categorize") console.log(TAG, "категории (" + q.optItems.length + " опций, " + q.categories.length + " категорий):", q.question);
    else if (type === "label") console.log(TAG, "метки (" + q.labels.length + "):", q.question);
    else if (type === "graph") console.log(TAG, "график:", q.question);
    else if (type === "match") console.log(TAG, "сопоставление (" + q.prompts.length + " пар):", q.question);
    else if (type === "dragfill") console.log(TAG, "плитки в пропуски (" + q.prompts.length + " пропусков, " + q.tiles.length + " плиток):", q.question);
    else if (type === "open") console.log(TAG, "открытый вопрос:", q.question);
    else if (type === "voice") console.log(TAG, "запись голосом:", q.question);
    else if (type === "mathinput") console.log(TAG, "матем. ввод:", q.question);
    else if (type === "draw") console.log(TAG, "рисование:", q.question);
    else if (type === "fibbox") console.log(TAG, "впиши в коробки (" + q.boxCount + "):", q.question);
    else if (type === "hotspot") console.log(TAG, "клик по картинке:", q.question);
    else if (type === "catgrid") console.log(TAG, "категории-галочки (" + q.items.length + " позиций, " + q.categories.length + " категорий):", q.question);
    else {
      console.log(TAG, "новый вопрос (" + type + "):", q.question);
      q.options.forEach((o) => console.log(TAG, "  вариант [" + o.index + "]:", o.text));
    }
    ask(q, sig);
  }

  let debounceTimer = null;
  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryLog, 400);
  }

  function forceAsk() {
    if (busy) { setIndicator("занят, подожди...", "#f59e0b"); return; }
    const q = adapter.readQuestion();
    const type = (q && q.type) || "single";
    if (!q || !SUPPORTED[type] || !isReady(q, type)) {
      setIndicator("нет поддерживаемого вопроса", "#f59e0b");
      return;
    }
    const sig = signature(q);
    lastSig = sig;
    adapter.clearHighlight();
    hideAnswer();
    console.log(TAG, "принудительный запрос (разбудить)");
    ask(q, sig);
  }

  // ================= Меню на странице =================
  function mk(tag, styles, props) {
    const el = document.createElement(tag);
    if (styles) Object.assign(el.style, styles);
    if (props) Object.assign(el, props);
    return el;
  }
  function row(label, control) {
    const r = mk("div", { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 8px" });
    r.appendChild(mk("span", { fontSize: "13px" }, { textContent: label }));
    r.appendChild(control);
    return r;
  }

  let gearEl = null, panelEl = null; // для очистки при горячей перезагрузке

  async function buildMenu() {
    const cfg = await store.get(["geminiKey", "enabled", "textOnly", "lang", "tokensUsed", "limitMsg", "authMsg", "wwTime", "wwMode"]);

    const gear = mk("div", {
      position: "fixed", top: "8px", right: "8px", zIndex: "2147483647",
      padding: "6px 10px", borderRadius: "8px", background: "#6c5ce7", color: "#fff",
      font: "12px system-ui, sans-serif", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.4)",
    }, { textContent: "⚙ TH" });
    document.body.appendChild(gear);

    const panel = mk("div", {
      position: "fixed", top: "38px", right: "8px", zIndex: "2147483647", width: "250px",
      padding: "12px", borderRadius: "10px", background: "#1f1f27", color: "#eee",
      font: "13px system-ui, sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,.6)", display: "none",
    });
    document.body.appendChild(panel);

    panel.appendChild(mk("div", { fontWeight: "600", marginBottom: "10px" }, { textContent: "TestHelper" }));

    const enabled = mk("input", null, { type: "checkbox", checked: cfg.enabled !== false });
    enabled.addEventListener("change", () => store.set({ enabled: enabled.checked }));
    panel.appendChild(row("Включено", enabled));

    const textonly = mk("input", null, { type: "checkbox", checked: cfg.textOnly === true });
    textonly.addEventListener("change", () => store.set({ textOnly: textonly.checked }));
    panel.appendChild(row("Только текст", textonly));

    const lang = mk("select", { background: "#2b2b35", color: "#eee", border: "1px solid #444", borderRadius: "5px", padding: "4px" });
    [["ru", "Рус"], ["uk", "Укр"], ["en", "Eng"]].forEach(([v, t]) => lang.appendChild(mk("option", null, { value: v, textContent: t })));
    lang.value = cfg.lang || "ru";
    lang.addEventListener("change", () => store.set({ lang: lang.value }));
    panel.appendChild(row("Язык", lang));

    if (adapter.name === "wordwall") {
      const clamp = (ms) => Math.max(1, Math.min(180000, Math.round(ms)));
      const box = mk("div", { margin: "8px 0", padding: "8px", border: "1px solid #3a3a45", borderRadius: "6px" });
      box.appendChild(mk("div", { fontSize: "12px", fontWeight: "600", marginBottom: "6px" }, { textContent: "Wordwall" }));
      const wmode = mk("select", { width: "100%", margin: "2px 0 6px", background: "#2b2b35", color: "#eee", border: "1px solid #444", borderRadius: "5px", padding: "4px" });
      [["server", "Режим: серверный"], ["canvas", "Режим: на канвасе"]].forEach(([v, t]) => wmode.appendChild(mk("option", null, { value: v, textContent: t })));
      wmode.value = cfg.wwMode || "server";
      wmode.addEventListener("change", () => store.set({ wwMode: wmode.value }));
      box.appendChild(wmode);
      box.appendChild(mk("div", { fontSize: "12px", color: "#aaa", marginBottom: "4px" }, { textContent: "время прохождения" }));
      const slider = mk("input", { width: "100%", margin: "2px 0" }, { type: "range", min: "1", max: "180000", step: "1" });
      const secRow = mk("div", { display: "flex", alignItems: "center", gap: "6px", margin: "4px 0" });
      const sec = mk("input", { width: "90px", background: "#2b2b35", color: "#eee", border: "1px solid #444", borderRadius: "5px", padding: "4px" }, { type: "number", step: "0.001", min: "0.001", max: "180" });
      secRow.appendChild(sec);
      secRow.appendChild(mk("span", { fontSize: "12px", color: "#aaa" }, { textContent: "сек (0.001 - 180)" }));
      let cur = clamp(cfg.wwTime || 800);
      const sync = (ms, from) => { cur = clamp(ms); store.set({ wwTime: cur }); slider.value = String(cur); if (from !== "sec") sec.value = String(+(cur / 1000).toFixed(3)); };
      slider.value = String(cur); sec.value = String(+(cur / 1000).toFixed(3));
      slider.addEventListener("input", () => sync(+slider.value));
      sec.addEventListener("change", () => sync((+sec.value || 0) * 1000, "sec"));
      const go = mk("button", { width: "100%", marginTop: "6px", background: "#6c5ce7", color: "#fff", border: "0", borderRadius: "5px", padding: "6px", cursor: "pointer" }, { textContent: "Пройти" });
      go.addEventListener("click", () => wordwallAdapter.run(cur, wmode.value));
      const dump = mk("button", { width: "100%", marginTop: "4px", background: "#3a3a45", color: "#fff", border: "0", borderRadius: "5px", padding: "6px", cursor: "pointer", fontSize: "12px" }, { textContent: "Копировать дамп" });
      dump.addEventListener("click", () => {
        const d = wordwallAdapter._diag || { note: "сначала запусти (клик закладки или «Пройти»)" };
        const txt = JSON.stringify(d, null, 1);
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
          () => setIndicator("дамп скопирован - вставь в чат", "#22c55e"),
          () => { console.log(TAG, "WW DUMP:\n" + txt); setIndicator("дамп в консоли (клипборд не дал)", "#f59e0b"); }
        );
      });
      box.appendChild(slider); box.appendChild(secRow); box.appendChild(go); box.appendChild(dump);
      panel.appendChild(box);
    }

    const tokWrap = mk("div", { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 8px" });
    const tok = mk("span", { fontSize: "13px" });
    tok.textContent = "Токенов: ";
    const tokB = mk("b", { color: "#8b7fff" }, { textContent: String(cfg.tokensUsed || 0) });
    tok.appendChild(tokB);
    const reset = mk("button", { background: "#3a3a45", color: "#fff", border: "0", borderRadius: "5px", padding: "4px 8px", cursor: "pointer", fontSize: "12px" }, { textContent: "Сброс" });
    reset.addEventListener("click", () => { store.set({ tokensUsed: 0 }); tokB.textContent = "0"; });
    tokWrap.appendChild(tok);
    tokWrap.appendChild(reset);
    panel.appendChild(tokWrap);

    const msg = mk("div", { color: "#eab308", fontSize: "12px", minHeight: "0", marginBottom: "4px" }, { textContent: cfg.limitMsg || cfg.authMsg || "" });
    panel.appendChild(msg);

    const key = mk("input", {
      width: "100%", boxSizing: "border-box", padding: "6px", margin: "4px 0",
      background: "#2b2b35", color: "#eee", border: "1px solid #444", borderRadius: "5px",
    }, { type: "password", placeholder: "API-ключ Gemini", value: cfg.geminiKey || "" });
    panel.appendChild(key);

    const status = mk("div", { color: "#6be675", fontSize: "12px", minHeight: "16px", margin: "4px 0" });
    const save = mk("button", { width: "100%", padding: "7px", background: "#6c5ce7", color: "#fff", border: "0", borderRadius: "5px", cursor: "pointer" }, { textContent: "Сохранить ключ" });
    save.addEventListener("click", () => {
      store.set({ geminiKey: key.value.trim(), authMsg: "" });
      status.textContent = "Сохранено";
      setTimeout(() => (status.textContent = ""), 1500);
    });
    panel.appendChild(save);

    const wake = mk("button", { width: "100%", padding: "7px", marginTop: "6px", background: "#3a3a45", color: "#fff", border: "0", borderRadius: "5px", cursor: "pointer" }, { textContent: "Разбудить (спросить сейчас)" });
    wake.addEventListener("click", () => forceAsk());
    panel.appendChild(wake);

    panel.appendChild(status);

    const toggle = async () => {
      const show = panel.style.display === "none";
      panel.style.display = show ? "block" : "none";
      if (show) {
        const c = await store.get(["tokensUsed", "limitMsg", "authMsg"]);
        tokB.textContent = String(c.tokensUsed || 0);
        msg.textContent = c.limitMsg || c.authMsg || "";
      }
    };
    gear.addEventListener("click", toggle);
    gearEl = gear;
    panelEl = panel;
  }

  // ================= Старт =================
  buildMenu();

  if (adapter.name === "edpuzzle") {
    (async () => {
      const c = await store.get(["enabled", "edMode"]);
      if (c.enabled === false) { setIndicator("выключено", "#666"); return; }
      try { await edpuzzleAdapter.run(c.edMode === "auto" ? "auto" : "highlight"); }
      catch (e) { console.warn(TAG, "Edpuzzle:", e.message); setIndicator("Edpuzzle: " + e.message, "#ef4444"); }
    })();
    window.__testhelperCleanup = function () {
      try { edpuzzleAdapter.cleanup(); } catch (e) {}
      [indicatorEl, typeBadgeEl, overlayEl, gearEl, panelEl].forEach((el) => { if (el) el.remove(); });
    };
    return;
  }

  if (adapter.name === "wordwall") {
    (async () => {
      const c = await store.get(["enabled"]);
      if (c.enabled === false) { setIndicator("выключено", "#666"); return; }
      try { wordwallAdapter.armAndRun(); }
      catch (e) { console.warn(TAG, "Wordwall:", e.message); setIndicator("Wordwall: " + e.message, "#ef4444"); }
    })();
    window.__testhelperCleanup = function () {
      try { if (wordwallAdapter._waitTimer) clearInterval(wordwallAdapter._waitTimer); } catch (e) {}
      [indicatorEl, typeBadgeEl, overlayEl, gearEl, panelEl].forEach((el) => { if (el) el.remove(); });
    };
    return;
  }

  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });
  schedule();

  // очистка для горячей перезагрузки (следующий клик закладки снесёт этот экземпляр)
  window.__testhelperCleanup = function () {
    try { mo.disconnect(); } catch (e) {}
    [indicatorEl, typeBadgeEl, overlayEl, gearEl, panelEl].forEach((el) => { if (el) el.remove(); });
  };
})();
