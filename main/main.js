// main/main.js
const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const store = require('./config-store');
const bcrypt = require('bcryptjs');
const { autoUpdater } = require('electron-updater');

let mainWindow;

/**
 * IMPORTANTE (SOLO PARA DESARROLLO)
 *
 * Antes de ejecutar `npm run build`, es necesario limpiar la caché de
 * `electron-builder`. Esto evita errores durante la compilación y, sobre todo,
 * impide que los tokens de prueba queden almacenados en el archivo de configuración.
 *
 * Para hacerlo:
 * 1. Descomenta la siguiente línea (`store.clear();`).
 * 2. Ejecuta `npm run build` o `npm start` para verificar que la limpieza se realizó correctamente.
 * 3. Una vez verificado, vuelve a comentar la línea para continuar con el desarrollo.
 */
// store.clear();

app.on('ready', () => {
    autoUpdater.checkForUpdatesAndNotify();
});


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        fullscreen: store.get('display_fullscreen'),
        // Icono definido para la ventana
        icon: path.join(__dirname, '../assets/icons/orvian.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // 1. Elimina el menú superior nativo (File, Edit, etc)
    mainWindow.setMenuBarVisibility(false);

    // 2. Control inteligente de DevTools
    // Si estamos en desarrollo, abrimos DevTools. Si es producción, se mantienen ocultas.
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    // 3. Atajo global: Ctrl + Shift + I (funciona en cualquier entorno)
    // Es el estándar de la industria y mucho más profesional que solo F12
    globalShortcut.register('CommandOrControl+Shift+I', () => {
        mainWindow.webContents.toggleDevTools();
    });

    mainWindow.loadFile('renderer/index.html');
}

// IPC Handlers
ipcMain.handle('config:get', (event, key) => store.get(key));
ipcMain.handle('config:set', (event, key, value) => store.set(key, value));
ipcMain.handle('pin:verify', async (_event, pin, hash) => {
    if (!hash) return true;
    return bcrypt.compare(pin, hash);
});
ipcMain.handle('get:resources-path', () => {
    // app.isPackaged = true en producción, false en `npm start`
    return app.isPackaged ? process.resourcesPath : null;
});

app.whenReady().then(createWindow);

// Limpiar atajos al cerrar para no dejar procesos colgados
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});