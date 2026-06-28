import { ApiClient, TokenRevokedError  } from './api-client.js';
import { UI } from './ui-states.js';
import { initFaceDetector, detectLoop } from './camera.js';
import { showPinGate } from './pin-gate.js';

let currentSessionId = null; 
let localStream = null;
let lastKnownSchoolName = "Politécnico Orvian";
let heartbeatInterval = null;

async function showConfigForm() {
    const url = await window.orvianConfig.get('server_url');
    const globalOverlay = document.getElementById('global-overlay');
    globalOverlay.classList.remove('hidden');
    
    globalOverlay.innerHTML = `
        <div class="p-8 bg-[#111113] rounded-3xl shadow-2xl w-96 border border-[#1e1e21] animate-fade-in">
            <h2 class="text-xl font-black mb-1 tracking-wide">Configurar Kiosko</h2>
            <p class="text-xs text-gray-500 mb-5">Establezca los parámetros de red locales.</p>
            <div class="space-y-3">
                <input id="server_url" placeholder="URL del Servidor (http://...)" value="${url || ''}" class="w-full p-3 bg-[#0a0a0b] border border-[#1e1e21] text-sm rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[#f78904] transition-colors"/>
                <input id="token" placeholder="Token de Kiosko" class="w-full p-3 bg-[#0a0a0b] border border-[#1e1e21] text-sm rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[#f78904] transition-colors"/>
                <button id="save" class="w-full bg-[#f78904] hover:bg-[#e07a04] p-3 rounded-xl transition-colors font-bold text-sm tracking-wide mt-2 shadow-lg shadow-black/40 text-white">Guardar y Conectar</button>
            </div>
        </div>
    `;
    
    document.getElementById('save').onclick = async () => {
        const urlValue = document.getElementById('server_url').value;
        const tkValue = document.getElementById('token').value;
        await window.orvianConfig.set('server_url', urlValue);
        await window.orvianConfig.set('kiosk_token', tkValue);
        location.reload(); 
    };
}

async function init() {

    await UI.init();

    const url = await window.orvianConfig.get('server_url');
    const token = await window.orvianConfig.get('kiosk_token');
    
    if (!token) {
        await showConfigForm();
        return; // Detener ejecución si no hay token
    }
    
    const client = new ApiClient(url, token);
    
    try {
        await initFaceDetector();

        const videoEl = document.getElementById('webcam');
        const canvasEl = document.getElementById('output-canvas');
        
        detectLoop(videoEl, canvasEl, async (activeVideoEl) => {
            UI.render('processing');
            
            // Canvas reducido — 480x360 en vez de 1280x720
            const captureCanvas = document.createElement('canvas');
            captureCanvas.width = 480;
            captureCanvas.height = 360;
            const ctx = captureCanvas.getContext('2d');
            ctx.drawImage(activeVideoEl, 0, 0, 480, 360); // ← escala al dibujar

            captureCanvas.toBlob(async (blob) => {
                try {
                    const result = await client.recordFacial(currentSessionId || '0', blob);
                    if (result.success) {
                        const timeString = new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true });
                        UI.render('success', { 
                            name: result.student.full_name,
                            photo_url: result.student.photo_url,
                            time: timeString,
                            status: result.status || 'Presente'
                        });
                    } else {
                        UI.render('error', { message: result.message || "No identificado" });
                    }
                } catch (e) {
                    UI.render('error', { message: "Error de comunicación" });
                }
            }, 'image/jpeg', 0.85);
        });

        await evaluateKioskState(client);
        heartbeatInterval = setInterval(() => evaluateKioskState(client), 30000);

    } catch (error) {
        console.error("Fallo inicialización:", error);
        UI.render('error', { message: "Fallo al cargar sistema" });
    }
}

async function evaluateKioskState(client) {
    try {
        const status = await client.getStatus();
        if (status?.school_name) lastKnownSchoolName = status.school_name;

        if (status?.session_active) {
            currentSessionId = status.session_id;
            await turnOnCamera();
        } else {
            currentSessionId = null;
            turnOffCamera();
        }
    } catch (err) {
        if (err instanceof TokenRevokedError) {
            // Detener el heartbeat antes de mostrar el PIN gate
            clearInterval(heartbeatInterval);

            showPinGate(() => {
                // Callback ejecutado al validar el PIN correctamente
                showConfigForm();
            });
        } else {
            // Otros errores (red, timeout, etc.) — mostrar estado de error sin salir del kiosko
            console.warn('Error de conexión:', err.message);
        }
    }
}

async function turnOnCamera() {
    if (localStream) return;
    UI.render('idle');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
        document.getElementById('webcam').srcObject = localStream;
    } catch (e) {
        UI.render('error', { message: "Cámara no disponible" });
    }
}

function turnOffCamera() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    const videoEl = document.getElementById('webcam');
    if (videoEl) videoEl.srcObject = null;
    if (document.getElementById('app').dataset.state !== 'no_session') {
        UI.render('no_session', { school_name: lastKnownSchoolName });
    }
}


init();