// main/config-store.js
const Store = require('electron-store');

// Si es la versión nueva, el constructor está en .default
const ConfigStore = Store.default || Store; 

const store = new ConfigStore({
    defaults: {
        server_url: '',
        kiosk_token: '',
        display_fullscreen: true,
        audio_enabled: true,
    }
});

module.exports = store;