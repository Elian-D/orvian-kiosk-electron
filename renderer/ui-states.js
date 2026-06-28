// renderer/ui-states.js

// Variable módulo — null = modo desarrollo (ruta relativa), string = producción (ruta absoluta)
let resourcesBasePath = null;

export const UI = {
    hasInitializedPanel: false,

    // Llamar una vez al arrancar la app, antes de cualquier render()
    async init() {
        resourcesBasePath = await window.orvianConfig.getResourcesPath();
    },

    render(state, data = {}) {
        const app = document.getElementById('app');
        if (!app) return;
        app.dataset.state = state; // Preservamos el control de flujo para camera.js

        // Forzar la estructura por defecto del panel derecho una sola vez
        if (!this.hasInitializedPanel) {
            this.initializeDefaultPanel();
        }

        // Mapeo de elementos DOM fijos
        const badgeDot = document.getElementById('badge-dot');
        const badgeText = document.getElementById('badge-text');
        const scannerPrompt = document.getElementById('scanner-prompt');
        const processingOverlay = document.getElementById('processing-overlay');
        const errorOverlay = document.getElementById('error-overlay');
        const globalOverlay = document.getElementById('global-overlay');

        switch(state) {
            case 'idle':
                // Ocultar capas transitorias
                processingOverlay.classList.add('opacity-0', 'pointer-events-none');
                errorOverlay.classList.add('opacity-0', 'pointer-events-none');
                globalOverlay.classList.add('hidden');
                scannerPrompt.classList.remove('opacity-0');

                // Estado del badge flotante
                badgeDot.className = "w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse";
                badgeText.textContent = "Escáner Activo";
                break;

            case 'processing':
                processingOverlay.classList.remove('opacity-0', 'pointer-events-none');
                scannerPrompt.classList.add('opacity-0');

                // Cambiado de azul a naranja de Orvian
                badgeDot.className = "w-2.5 h-2.5 rounded-full bg-[#f78904] animate-pulse";
                badgeText.textContent = "Validando...";
                break;

            case 'success':
                processingOverlay.classList.add('opacity-0', 'pointer-events-none');
                scannerPrompt.classList.remove('opacity-0');

                badgeDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-500/50";
                badgeText.textContent = "Asistencia Registrada";

                // Feedback Visual: Flash Verde
                const flash = document.getElementById('scanner-flash');
                if (flash) {
                    flash.classList.remove('opacity-0'); // Encender
                    flash.classList.add('opacity-30');   // Brillo verde suave (ajusta a 0.5 si quieres más fuerte)
                    
                    setTimeout(() => {
                        flash.classList.add('opacity-0');
                        flash.classList.remove('opacity-30');
                    }, 300);
                }

                playFeedback('success', 0.8);
                this.updateStudentCard(data);

                setTimeout(() => {
                    if (app.dataset.state === 'success') this.render('idle');
                }, 1800);
                break;

            case 'error':
                processingOverlay.classList.add('opacity-0', 'pointer-events-none');
                scannerPrompt.classList.add('opacity-0');

                // Configurar mensaje específico
                const errorMsgTxt = document.getElementById('error-message-text');
                if (errorMsgTxt) errorMsgTxt.textContent = data.message || "No se detectó ninguna coincidencia.";

                errorOverlay.classList.remove('opacity-0', 'pointer-events-none');

                badgeDot.className = "w-2.5 h-2.5 rounded-full bg-red-500";
                badgeText.textContent = "Reintentar";

                playFeedback('error', 0.3); // Volumen al 30%

                setTimeout(() => {
                    if (app.dataset.state === 'error') this.render('idle');
                }, 1500);
                break;

            case 'no_session':
                processingOverlay.classList.add('opacity-0', 'pointer-events-none');
                errorOverlay.classList.add('opacity-0', 'pointer-events-none');
                
                globalOverlay.classList.remove('hidden');
                // Actualizado con los colores del tema oscuro Charcoal (bg y border)
                globalOverlay.innerHTML = `
                    <div class="text-center p-10 bg-[#111113] border border-[#1e1e21] rounded-3xl shadow-2xl max-w-md animate-fade-in">
                        <div class="w-14 h-14 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center mx-auto mb-5">
                            <span class="text-yellow-500 text-2xl font-bold">⚠️</span>
                        </div>
                        <h1 class="text-xl font-black text-gray-100 mb-2 tracking-wide">Sin Jornada Activa</h1>
                        <p class="text-xs text-gray-400 font-medium mb-4">${data.school_name || 'Plantel Escolar'}</p>
                        <p class="text-gray-500 text-[11px] leading-relaxed">El dispositivo se encuentra en modo pasivo. La cámara se iniciará automáticamente cuando el servidor central habilite una sesión horaria válida.</p>
                    </div>
                `;
                break;
        }
    },

    initializeDefaultPanel() {
        const studentPanel = document.getElementById('student-panel');
        if (!studentPanel) return;

        // Actualizado con bordes Charcoal coherentes
        studentPanel.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center flex-1 px-4 h-full" id="student-card-wrapper">
                <div class="w-16 h-16 rounded-2xl border-2 border-dashed border-[#1e1e21] flex items-center justify-center mb-4 text-gray-700">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                </div>
                <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest">Kiosko Listo</h3>
                <p class="text-[11px] text-gray-500 mt-2 max-w-[180px] leading-relaxed">A la espera del escaneo del primer estudiante de la jornada.</p>
            </div>
            <div class="border-t border-[#1e1e21] pt-4 text-center mt-auto w-full">
                <p class="text-[9px] font-black text-gray-600 tracking-widest uppercase">ORVIAN SRL • HARDWARE NODE</p>
            </div>
        `;
        this.hasInitializedPanel = true;
    },

    updateStudentCard(data) {
        const wrapper = document.getElementById('student-card-wrapper');
        if (!wrapper) return;

        // 1. Traducción del estado (Lógica de comparación)
        let statusLabel = data.status;
        let statusBadgeClasses = "bg-[#f78904]/10 text-[#f78904] border border-[#f78904]/20";

        if (data.status?.toLowerCase() === 'presente' || data.status?.toLowerCase() === 'present') {
            statusLabel = "Presente";
            statusBadgeClasses = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
        } else if (data.status?.toLowerCase() === 'tarde' || data.status?.toLowerCase() === 'late') {
            statusLabel = "Tarde";
            statusBadgeClasses = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
        }

        wrapper.className = "flex flex-col items-center text-center flex-1 justify-center h-full py-6 animate-fade-in";
        
        wrapper.innerHTML = `
            <div class="mb-6">
                <span class="px-6 py-2 rounded-full text-xs font-black tracking-widest uppercase shadow-sm ${statusBadgeClasses}">
                    ${statusLabel}
                </span>
            </div>

            <!-- Foto agrandada sin sombra/blur -->
            <div class="relative w-64 h-64 rounded-3xl overflow-hidden border-4 border-[#1e1e21] shadow-2xl mb-6 bg-gray-900">
                <img src="${data.photo_url || ''}" 
                    class="w-full h-full object-cover scale-110" 
                    style="object-position: center 20%;" 
                    onerror="this.src='https://ui-avatars.com/api/?name='+encodeURIComponent('${data.name}')+'&background=0a0a0b&color=ffffff&size=256'">
            </div>

            <!-- Nombre con tamaño optimizado -->
            <h2 class="text-2xl font-black text-white leading-tight mb-8 px-4 w-full break-words">
                ${data.name}
            </h2>

            <!-- Sección de hora destacada -->
            <div class="w-full px-6">
                <div class="bg-[#0a0a0b]/40 p-5 rounded-2xl border border-[#1e1e21] text-center">
                    <span class="text-[10px] uppercase text-gray-500 font-bold tracking-widest block mb-1">Hora de registro</span>
                    <span class="text-4xl font-mono font-black text-white">${data.time}</span>
                </div>
            </div>
        `;
    }
};

/**
 * Reproduce un sonido de retroalimentación.
 * La ruta ahora apunta a la raíz del proyecto.
 */
function playFeedback(soundName, volume = 1.0) {
    // En dev: resourcesBasePath es null → usa ruta relativa (funciona igual que antes)
    // En prod: resourcesBasePath es "C:\...\resources" → usa ruta absoluta file://
    const src = resourcesBasePath
        ? `file://${resourcesBasePath}/assets/sounds/${soundName}.wav`
        : `../assets/sounds/${soundName}.wav`;

    const audio = new Audio(src);
    audio.volume = volume;
    audio.play().catch(e => console.log("Audio omitido:", e));
}