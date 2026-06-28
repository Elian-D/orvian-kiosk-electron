// renderer/pin-gate.js
// SIN imports de bcryptjs — la comparación va al proceso principal vía IPC

export async function showPinGate(onUnlocked) {
    const cachedHash = await window.orvianConfig.get('cached_pin_hash');

    const container = document.getElementById('app');
    container.innerHTML = `
        <div class="w-full min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
            <div class="w-full max-w-sm space-y-6">
                <div class="text-center space-y-2">
                    <div class="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
                        <svg class="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 9h10.5a2.25
                                   2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25
                                   2.25 0 004.5 12v6.75A2.25 2.25 0 006.75 21.75z" />
                        </svg>
                    </div>
                    <h1 class="text-xl font-bold text-white">Token revocado</h1>
                    <p class="text-sm text-gray-400">
                        Este dispositivo ya no tiene acceso al sistema.<br>
                        Ingresa el PIN de técnico para reconfigurar.
                    </p>
                </div>

                ${cachedHash ? `
                    <div class="space-y-3">
                        <input
                            id="pin-input"
                            type="password"
                            inputmode="numeric"
                            maxlength="6"
                            placeholder="PIN de técnico"
                            class="w-full text-center text-2xl tracking-[0.5em] bg-white/5 border border-white/10
                                   rounded-2xl px-4 py-4 text-white placeholder-gray-600
                                   focus:outline-none focus:border-[#f78904]/50 transition-all" />
                        <p id="pin-error" class="text-xs text-red-400 text-center hidden">
                            PIN incorrecto. Inténtalo de nuevo.
                        </p>
                        <button id="pin-submit"
                            class="w-full py-3 rounded-2xl bg-[#f78904] hover:bg-[#e07a04]
                                   text-white font-bold text-sm transition-colors">
                            Desbloquear
                        </button>
                    </div>
                ` : `
                    <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center">
                        <p class="text-sm text-amber-300">
                            No hay PIN almacenado en este dispositivo.<br>
                            Puedes reconfigurar directamente.
                        </p>
                    </div>
                    <button id="pin-submit"
                        class="w-full py-3 rounded-2xl bg-[#f78904] hover:bg-[#e07a04]
                               text-white font-bold text-sm transition-colors">
                        Ir a configuración
                    </button>
                `}
            </div>
        </div>
    `;

    const submitBtn = document.getElementById('pin-submit');
    const pinInput  = document.getElementById('pin-input');
    const pinError  = document.getElementById('pin-error');

    submitBtn.addEventListener('click', async () => {
        if (!cachedHash) {
            onUnlocked();
            return;
        }

        const entered = pinInput?.value?.trim();
        if (!entered) return;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando...';

        // La comparación bcrypt ocurre en el proceso principal (Node.js), no aquí
        const valid = await window.orvianConfig.verifyPin(entered, cachedHash);

        if (valid) {
            onUnlocked();
        } else {
            pinError.classList.remove('hidden');
            pinInput.value = '';
            pinInput.focus();
            submitBtn.disabled = false;
            submitBtn.textContent = 'Desbloquear';
        }
    });

    pinInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitBtn.click();
    });
    
    // Auto-focus al input si existe
    setTimeout(() => pinInput?.focus(), 100);
}