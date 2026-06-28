// renderer/api-client.js

export class ApiClient {
    constructor(serverUrl, token) {
        this.base = `${serverUrl.replace(/\/$/, '')}/api/v1/kiosk`;
        this.headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',   // ← Fix crítico
        };
    }

    async getStatus() {
        const resp = await fetch(`${this.base}/status`, { headers: this.headers });

        if (resp.status === 401) {
            throw new TokenRevokedError();
        }

        if (!resp.ok) {
            throw new Error(`Status ${resp.status}`);
        }

        const data = await resp.json();

        // Cachear el pin_hash en electron-store para validación offline posterior
        if (data.pin_hash) {
            // Siempre sobreescribir — null incluido (maneja el caso de PIN eliminado)
            await window.orvianConfig.set('cached_pin_hash', data.pin_hash ?? null);
        }

        return data;
    }

    async recordFacial(sessionId, blob) {
        const form = new FormData();
        form.append('session_id', sessionId);
        form.append('photo', blob, 'capture.jpg');

        const resp = await fetch(`${this.base}/record/facial`, {
            method: 'POST',
            headers: this.headers,
            body: form,
        });

        if (resp.status === 401) {
            throw new TokenRevokedError();
        }

        return resp.json();
    }
}

export class TokenRevokedError extends Error {
    constructor() {
        super('TOKEN_REVOKED');
        this.name = 'TokenRevokedError';
    }
}