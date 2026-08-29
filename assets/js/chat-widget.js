// ===========================
// CHAT WIDGET - METRO MICHIGAN PROPERTY BUYERS
// ===========================
// Self-contained floating chat assistant. Drop this one script onto any public
// page (after assets/js/config.js) and it injects its own markup and styles:
//
//   <script src="/assets/js/config.js"></script>
//   <script src="/assets/js/chat-widget.js" defer></script>
//
// Talks to POST /api/chat on the backend. The Gemini key lives server-side.

(function () {
    'use strict';

    // ===========================
    // CONFIG
    // ===========================

    var SELL_FORM_PATH = '/pages/sell-your-house/sell.html';
    var HISTORY_TURNS = 8;          // turns replayed to the server, matches the backend window
    var MAX_MESSAGE_LENGTH = 1000;

    var GREETING =
        "Hi! I'm the Metro Michigan Property Buyers assistant. Ask me anything about selling your house " +
        'for cash — how the process works, timelines, fees, or what to expect.';

    var SUGGESTIONS = [
        'How does the process work?',
        'How fast can I close?',
        'Are there any fees?',
        'What condition does my house need to be in?'
    ];

    var OFFLINE_MESSAGE =
        "I'm having trouble connecting right now. Please try the contact form, " +
        'or call (517) 500-8870.';

    // ===========================
    // STATE
    // ===========================

    var history = [];   // [{ role: 'user' | 'model', text: string }]
    var sessionId = getSessionId();
    var isSending = false;
    var isOpen = false;
    var els = {};

    function getSessionId() {
        try {
            var key = 'hsd_chat_session';
            var existing = sessionStorage.getItem(key);
            if (existing) return existing;
            var id = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            sessionStorage.setItem(key, id);
            return id;
        } catch (e) {
            // Private mode or storage disabled: fall back to a per-load id.
            return 's-' + Math.random().toString(36).slice(2, 12);
        }
    }

    // ===========================
    // STYLES
    // ===========================

    var CSS = [
        '.hsd-chat, .hsd-chat * { box-sizing: border-box; }',
        '.hsd-chat {',
        '  position: fixed; right: 20px; bottom: 20px; z-index: 9999;',
        "  font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
        '}',

        /* Launcher bubble */
        '.hsd-chat__launcher {',
        '  width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;',
        '  background: #D32F2F; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.24);',
        '  display: flex; align-items: center; justify-content: center;',
        '  transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), background 0.25s;',
        '}',
        '.hsd-chat__launcher:hover { background: #B71C1C; transform: scale(1.06); }',
        '.hsd-chat__launcher:focus-visible { outline: 3px solid #FFA000; outline-offset: 3px; }',
        '.hsd-chat__launcher svg { width: 28px; height: 28px; fill: currentColor; }',
        '.hsd-chat__launcher--hidden { display: none; }',

        /* Panel */
        '.hsd-chat__panel {',
        '  width: 370px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 110px);',
        '  background: #fff; border-radius: 14px; overflow: hidden;',
        '  box-shadow: 0 12px 40px rgba(0,0,0,0.26); display: none; flex-direction: column;',
        '  animation: hsd-pop 0.22s cubic-bezier(0.4,0,0.2,1);',
        '}',
        '.hsd-chat__panel--open { display: flex; }',
        '@keyframes hsd-pop { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }',
        '@media (prefers-reduced-motion: reduce) {',
        '  .hsd-chat__panel { animation: none; }',
        '  .hsd-chat__launcher { transition: none; }',
        '}',

        /* Header */
        '.hsd-chat__header {',
        '  background: #D32F2F; color: #fff; padding: 14px 16px;',
        '  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;',
        '}',
        '.hsd-chat__title {',
        "  font-family: 'Bebas Neue', 'Source Sans 3', sans-serif; letter-spacing: 0.5px;",
        '  font-size: 1.25rem; line-height: 1.1; margin: 0;',
        '}',
        '.hsd-chat__subtitle { font-size: 0.75rem; opacity: 0.9; margin: 2px 0 0; }',
        '.hsd-chat__close {',
        '  margin-left: auto; background: transparent; border: none; color: #fff;',
        '  font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 0 4px; opacity: 0.85;',
        '}',
        '.hsd-chat__close:hover { opacity: 1; }',
        '.hsd-chat__close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }',

        /* Message list */
        '.hsd-chat__log {',
        '  flex: 1 1 auto; overflow-y: auto; padding: 16px; background: #F5F5F5;',
        '  display: flex; flex-direction: column; gap: 10px;',
        '}',
        '.hsd-chat__msg {',
        '  max-width: 85%; padding: 10px 13px; border-radius: 12px;',
        '  font-size: 0.92rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;',
        '}',
        '.hsd-chat__msg--bot { background: #fff; color: #1A1A1A; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }',
        '.hsd-chat__msg--user { background: #1976D2; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }',
        '.hsd-chat__msg--error { background: #FFEBEE; color: #B71C1C; align-self: flex-start; border-bottom-left-radius: 4px; }',
        '.hsd-chat__msg a { color: inherit; font-weight: 600; }',
        '.hsd-chat__msg--bot a { color: #D32F2F; }',

        /* Suggestion chips */
        '.hsd-chat__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }',
        '.hsd-chat__chip {',
        '  background: #fff; border: 1px solid #E0E0E0; color: #4A4A4A; cursor: pointer;',
        '  border-radius: 999px; padding: 6px 12px; font-size: 0.8rem; font-family: inherit;',
        '  transition: border-color 0.2s, color 0.2s;',
        '}',
        '.hsd-chat__chip:hover { border-color: #D32F2F; color: #D32F2F; }',

        /* Typing indicator */
        '.hsd-chat__typing { display: flex; gap: 4px; align-items: center; padding: 12px 13px; }',
        '.hsd-chat__typing span {',
        '  width: 7px; height: 7px; border-radius: 50%; background: #9E9E9E;',
        '  animation: hsd-bounce 1.2s infinite ease-in-out;',
        '}',
        '.hsd-chat__typing span:nth-child(2) { animation-delay: 0.15s; }',
        '.hsd-chat__typing span:nth-child(3) { animation-delay: 0.3s; }',
        '@keyframes hsd-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-5px); opacity: 1; } }',

        /* Composer */
        '.hsd-chat__form {',
        '  flex: 0 0 auto; display: flex; gap: 8px; padding: 12px;',
        '  border-top: 1px solid #E0E0E0; background: #fff; align-items: flex-end;',
        '}',
        '.hsd-chat__input {',
        '  flex: 1 1 auto; resize: none; border: 1px solid #E0E0E0; border-radius: 10px;',
        '  padding: 9px 12px; font-family: inherit; font-size: 0.92rem; line-height: 1.4;',
        '  max-height: 96px; color: #1A1A1A;',
        '}',
        '.hsd-chat__input:focus { outline: none; border-color: #D32F2F; }',
        '.hsd-chat__send {',
        '  flex: 0 0 auto; width: 40px; height: 40px; border-radius: 10px; border: none;',
        '  background: #D32F2F; color: #fff; cursor: pointer; display: flex;',
        '  align-items: center; justify-content: center;',
        '}',
        '.hsd-chat__send:hover:not(:disabled) { background: #B71C1C; }',
        '.hsd-chat__send:disabled { background: #E0E0E0; cursor: not-allowed; }',
        '.hsd-chat__send svg { width: 18px; height: 18px; fill: currentColor; }',
        '.hsd-chat__legal { font-size: 0.68rem; color: #6B6B6B; text-align: center; padding: 0 12px 10px; background: #fff; margin: 0; }',

        '@media (max-width: 480px) {',
        '  .hsd-chat { right: 12px; bottom: 12px; }',
        '  .hsd-chat__panel { width: calc(100vw - 24px); height: calc(100vh - 96px); }',
        '}'
    ].join('\n');

    // ===========================
    // MARKUP
    // ===========================

    var ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm0 4h7v2H7v-2z"/></svg>';
    var ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>';

    function buildUI() {
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        var root = document.createElement('div');
        root.className = 'hsd-chat';
        root.innerHTML =
            '<div class="hsd-chat__panel" role="dialog" aria-modal="false" aria-label="Chat with Metro Michigan Property Buyers">' +
                '<div class="hsd-chat__header">' +
                    '<div>' +
                        '<p class="hsd-chat__title">Metro Michigan Property Buyers</p>' +
                        '<p class="hsd-chat__subtitle">Ask us about selling your home</p>' +
                    '</div>' +
                    '<button type="button" class="hsd-chat__close" aria-label="Close chat">&times;</button>' +
                '</div>' +
                '<div class="hsd-chat__log" role="log" aria-live="polite" aria-atomic="false"></div>' +
                '<form class="hsd-chat__form">' +
                    '<textarea class="hsd-chat__input" rows="1" placeholder="Type your question..." ' +
                        'aria-label="Your message" maxlength="' + MAX_MESSAGE_LENGTH + '"></textarea>' +
                    '<button type="submit" class="hsd-chat__send" aria-label="Send message">' + ICON_SEND + '</button>' +
                '</form>' +
                '<p class="hsd-chat__legal">Automated assistant. It cannot quote offers or give legal advice.</p>' +
            '</div>' +
            '<button type="button" class="hsd-chat__launcher" aria-label="Open chat" aria-expanded="false">' + ICON_CHAT + '</button>';

        document.body.appendChild(root);

        els.root = root;
        els.panel = root.querySelector('.hsd-chat__panel');
        els.launcher = root.querySelector('.hsd-chat__launcher');
        els.close = root.querySelector('.hsd-chat__close');
        els.log = root.querySelector('.hsd-chat__log');
        els.form = root.querySelector('.hsd-chat__form');
        els.input = root.querySelector('.hsd-chat__input');
        els.send = root.querySelector('.hsd-chat__send');
    }

    // ===========================
    // RENDERING
    // ===========================

    function scrollToBottom() {
        els.log.scrollTop = els.log.scrollHeight;
    }

    // Text always goes in via textContent. Only after that do we linkify the
    // sell-form path, so model output can never inject markup.
    function addMessage(text, kind) {
        var el = document.createElement('div');
        el.className = 'hsd-chat__msg hsd-chat__msg--' + kind;
        el.textContent = text;

        if (kind === 'bot' && text.indexOf(SELL_FORM_PATH) !== -1) {
            var parts = el.textContent.split(SELL_FORM_PATH);
            el.textContent = '';
            parts.forEach(function (part, i) {
                el.appendChild(document.createTextNode(part));
                if (i < parts.length - 1) {
                    var a = document.createElement('a');
                    a.href = SELL_FORM_PATH;
                    a.textContent = 'our cash offer form';
                    el.appendChild(a);
                }
            });
        }

        els.log.appendChild(el);
        scrollToBottom();
        return el;
    }

    function addSuggestions() {
        var wrap = document.createElement('div');
        wrap.className = 'hsd-chat__chips';
        SUGGESTIONS.forEach(function (text) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'hsd-chat__chip';
            chip.textContent = text;
            chip.addEventListener('click', function () {
                wrap.remove();
                send(text);
            });
            wrap.appendChild(chip);
        });
        els.log.appendChild(wrap);
        scrollToBottom();
    }

    function showTyping() {
        var el = document.createElement('div');
        el.className = 'hsd-chat__msg hsd-chat__msg--bot hsd-chat__typing';
        el.setAttribute('aria-label', 'Assistant is typing');
        el.innerHTML = '<span></span><span></span><span></span>';
        els.log.appendChild(el);
        scrollToBottom();
        return el;
    }

    // ===========================
    // SENDING
    // ===========================

    function setBusy(busy) {
        isSending = busy;
        els.send.disabled = busy;
        els.input.disabled = busy;
    }

    async function send(rawText) {
        var text = String(rawText || '').trim();
        if (!text || isSending) return;

        if (text.length > MAX_MESSAGE_LENGTH) text = text.slice(0, MAX_MESSAGE_LENGTH);

        addMessage(text, 'user');
        els.input.value = '';
        els.input.style.height = 'auto';
        setBusy(true);

        var typing = showTyping();

        try {
            var endpoint = (window.HSD_CONFIG && window.HSD_CONFIG.apiUrl)
                ? window.HSD_CONFIG.apiUrl('/api/chat')
                : '/api/chat';

            var res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    history: history.slice(-HISTORY_TURNS),
                    sessionId: sessionId
                })
            });

            var data = await res.json().catch(function () { return null; });
            typing.remove();

            if (res.status === 429) {
                addMessage(
                    (data && data.reply) ||
                    "You're sending messages faster than I can keep up. Give me a moment and try again.",
                    'error'
                );
                return;
            }

            if (!res.ok || !data || !data.reply) {
                addMessage((data && data.reply) || OFFLINE_MESSAGE, 'error');
                return;
            }

            addMessage(data.reply, 'bot');

            history.push({ role: 'user', text: text });
            history.push({ role: 'model', text: data.reply });
            if (history.length > HISTORY_TURNS) history = history.slice(-HISTORY_TURNS);

        } catch (err) {
            typing.remove();
            addMessage(OFFLINE_MESSAGE, 'error');
        } finally {
            setBusy(false);
            if (isOpen) els.input.focus();
        }
    }

    // ===========================
    // OPEN / CLOSE
    // ===========================

    function open() {
        isOpen = true;
        els.panel.classList.add('hsd-chat__panel--open');
        els.launcher.classList.add('hsd-chat__launcher--hidden');
        els.launcher.setAttribute('aria-expanded', 'true');

        if (!els.log.childElementCount) {
            addMessage(GREETING, 'bot');
            addSuggestions();
        }
        els.input.focus();
    }

    function close() {
        isOpen = false;
        els.panel.classList.remove('hsd-chat__panel--open');
        els.launcher.classList.remove('hsd-chat__launcher--hidden');
        els.launcher.setAttribute('aria-expanded', 'false');
        els.launcher.focus();
    }

    // ===========================
    // INIT
    // ===========================

    function init() {
        if (document.querySelector('.hsd-chat')) return;   // never double-mount
        buildUI();

        els.launcher.addEventListener('click', open);
        els.close.addEventListener('click', close);

        els.form.addEventListener('submit', function (e) {
            e.preventDefault();
            send(els.input.value);
        });

        // Enter sends, Shift+Enter makes a new line.
        els.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(els.input.value);
            }
        });

        // Grow the textarea with its content, up to the CSS max-height.
        els.input.addEventListener('input', function () {
            els.input.style.height = 'auto';
            els.input.style.height = Math.min(els.input.scrollHeight, 96) + 'px';
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen) close();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
