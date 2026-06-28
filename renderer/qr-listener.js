// renderer/qr-listener.js

import { UI } from './ui-states.js';

let _client = null;
let _sessionIdRef = null;
let _isListening = false;

// ── Configuración ────────────────────────────────────────────────
// Tiempo de silencio (ms) antes de procesar el buffer si el lector no envía Enter.
// Los lectores USB típicamente envían todos los caracteres en <50ms.
// 150ms de silencio = escaneo completo sin Enter.
const SILENCE_THRESHOLD_MS = 150;

// Longitud mínima para considerar el buffer como un código válido.
// Evita procesar teclas accidentales aisladas.
const MIN_CODE_LENGTH = 3;

// ── Estado del buffer ─────────────────────────────────────────────
let buffer = '';
let bufferTimer = null;

// ── Log de debug ──────────────────────────────────────────────────
const DEBUG_ENABLED = false; // ← cambiar a false antes de distribuir
const MAX_LOG_ENTRIES = 6;
let logEntries = [];

function debugLog(message, type = 'info') {
    if (!DEBUG_ENABLED) return;

    const colors = {
        info:    '#6b7280',
        success: '#10b981',
        error:   '#ef4444',
        scan:    '#f78904',
        buffer:  '#3b82f6',
    };

    const entry = {
        time: new Date().toLocaleTimeString('es-DO', { hour12: false }),
        message,
        color: colors[type] || colors.info,
    };

    logEntries.unshift(entry);
    logEntries = logEntries.slice(0, MAX_LOG_ENTRIES);
    renderDebugPanel();
}

function renderDebugPanel() {
    let panel = document.getElementById('qr-debug-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'qr-debug-panel';
        panel.style.cssText = `
            position: fixed; bottom: 48px; left: 12px; z-index: 9999;
            background: rgba(0,0,0,0.85); border: 1px solid #1e1e21;
            border-radius: 12px; padding: 10px 14px; min-width: 280px;
            font-family: monospace; font-size: 10px; pointer-events: none;
        `;
        document.body.appendChild(panel);
    }

    panel.innerHTML = `
        <div style="color:#f78904; font-weight:bold; margin-bottom:6px; font-size:9px; letter-spacing:0.1em; text-transform:uppercase;">
            QR Listener — Debug
        </div>
        ${logEntries.map(e => `
            <div style="color:${e.color}; margin-bottom:3px; display:flex; gap:8px;">
                <span style="color:#374151; flex-shrink:0;">${e.time}</span>
                <span>${e.message}</span>
            </div>
        `).join('')}
    `;
}

// ── Exports públicos ──────────────────────────────────────────────
export function startQrListener(client, getSessionId) {
    if (_isListening) return;
    _client = client;
    _sessionIdRef = getSessionId;
    _isListening = true;

    let hiddenInput = document.getElementById('qr-wedge-input');
    if (!hiddenInput) {
        hiddenInput = document.createElement('input');
        hiddenInput.id = 'qr-wedge-input';
        hiddenInput.setAttribute('aria-hidden', 'true');
        hiddenInput.style.cssText = `
            position: fixed; top: -9999px; left: -9999px;
            opacity: 0; width: 1px; height: 1px;
            pointer-events: none;
        `;
        document.body.appendChild(hiddenInput);
    }

    hiddenInput.addEventListener('keydown', handleQrKeydown);
    document.addEventListener('focusin', refocusHiddenInput);
    hiddenInput.focus();

    debugLog('Listener iniciado', 'info');
}

export function stopQrListener() {
    if (!_isListening) return;
    _isListening = false;

    const hiddenInput = document.getElementById('qr-wedge-input');
    if (hiddenInput) {
        hiddenInput.removeEventListener('keydown', handleQrKeydown);
    }
    document.removeEventListener('focusin', refocusHiddenInput);

    buffer = '';
    clearTimeout(bufferTimer);

    debugLog('Listener detenido', 'info');
}

// ── Lógica interna ────────────────────────────────────────────────
function refocusHiddenInput(event) {
    const globalOverlay = document.getElementById('global-overlay');
    if (globalOverlay && !globalOverlay.classList.contains('hidden')) return;

    const hiddenInput = document.getElementById('qr-wedge-input');
    if (hiddenInput && event.target !== hiddenInput) {
        hiddenInput.focus();
    }
}

function handleQrKeydown(event) {
    // Camino rápido: lector que SÍ envía Enter
    if (event.key === 'Enter') {
        clearTimeout(bufferTimer);
        const code = buffer.trim();
        buffer = '';

        if (code.length >= MIN_CODE_LENGTH) {
            debugLog(`Enter recibido → "${code}"`, 'scan');
            processQrCode(code);
        } else if (code.length > 0) {
            debugLog(`Enter con buffer corto ignorado: "${code}"`, 'error');
        }
        return;
    }

    // Acumular caracteres imprimibles
    if (event.key.length === 1) {
        buffer += event.key;
        debugLog(`Buffer: "${buffer}"`, 'buffer');
    }

    // Camino de timeout: lector que NO envía Enter
    // El timer se reinicia en cada carácter nuevo.
    // Cuando paran de llegar caracteres (silencio = escaneo completo), se procesa.
    clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => {
        const code = buffer.trim();
        buffer = '';

        if (code.length >= MIN_CODE_LENGTH) {
            debugLog(`Timeout → procesando "${code}"`, 'scan');
            processQrCode(code);
        } else if (code.length > 0) {
            debugLog(`Timeout con buffer corto descartado: "${code}"`, 'error');
        }
    }, SILENCE_THRESHOLD_MS);
}

async function processQrCode(code) {
    const sessionId = _sessionIdRef ? _sessionIdRef() : null;

    if (!sessionId) {
        debugLog('Sin sesión activa — ignorado', 'error');
        return;
    }

    if (document.getElementById('app')?.dataset.state === 'processing') {
        debugLog('Ya procesando — ignorado', 'error');
        return;
    }

    debugLog(`Enviando a API: "${code}"`, 'info');
    UI.render('processing');

    try {
        const result = await _client.recordQr(sessionId, code);

        if (result.success) {
            const timeString = new Date().toLocaleTimeString('es-DO', {
                hour: '2-digit', minute: '2-digit', hour12: true
            });
            debugLog(`✓ ${result.student?.full_name}`, 'success');
            UI.render('success', {
                name:      result.student.full_name,
                photo_url: result.student.photo_url,
                time:      timeString,
                status:    result.status || 'Presente',
            });
        } else {
            debugLog(`✗ ${result.message || 'No reconocido'}`, 'error');
            UI.render('error', { message: result.message || 'Código no reconocido' });
        }
    } catch (e) {
        debugLog(`Error: ${e.message}`, 'error');
        UI.render('error', { message: 'Error de comunicación' });
    }
}
