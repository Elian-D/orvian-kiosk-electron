# ORVIAN Kiosko
## Cliente de escritorio para registro de asistencia biométrica

Parte del ecosistema **[ORVIAN](https://github.com/Elian-D/orvian)** — Sistema Integral de Gestión Educativa para instituciones dominicanas.

---

## 📌 Descripción general

**orvian-kiosk-electron** es la aplicación de escritorio que opera como terminal física de registro de asistencia en la portería de un centro educativo. Funciona como intermediario entre la cámara del dispositivo y el backend Laravel de ORVIAN: detecta un rostro, captura el frame y lo envía al API Gateway del servidor para su identificación y registro.

La aplicación corre de forma **completamente offline** en lo que respecta a sus dependencias — todos los modelos de visión artificial y assets van empaquetados dentro del instalador `.exe`. La única comunicación de red es la que tiene con el servidor ORVIAN propio de la institución.

> **Contexto del pivote arquitectónico:** Las versiones anteriores del módulo de asistencia biométrica intentaban ejecutar el procesamiento de visión en el navegador web. Dos problemas estructurales lo hicieron inviable en redes escolares dominicanas: los archivos WASM de MediaPipe (~18 MB) son bloqueados por firewalls Fortinet, y las fugas de memoria de `getUserMedia` + WASM en sesiones largas son difíciles de mitigar en un contexto de producción. Electron resuelve ambos: los WASM viajan dentro del instalador y el proceso de renderizado tiene un ciclo de vida controlado.

---

## 🏗️ Arquitectura

La aplicación se divide en dos procesos aislados que se comunican por IPC:

```
┌──────────────────────────────────────────────────────────────┐
│                  orvian-kiosk-electron                        │
│                                                                │
│  ┌────────────────────────┐      ┌─────────────────────────┐ │
│  │   Proceso Principal     │      │  Proceso de Renderizado  │ │
│  │   (Node.js)              │      │  (Chromium local)        │ │
│  │                          │      │                          │ │
│  │  • main.js               │◀────▶│  • index.html            │ │
│  │  • config-store.js       │ IPC  │  • camera.js             │ │
│  │    (token, server_url,   │      │    (getUserMedia +        │ │
│  │     cached_pin_hash)     │      │     MediaPipe WASM local) │ │
│  │  • preload.js (bridge)   │      │  • api-client.js         │ │
│  │  • bcryptjs (PIN verify) │      │  • ui-states.js          │ │
│  │  • hardware/             │      │  • setup-screen.js       │ │
│  │    fingerprint.js        │      │  • pin-gate.js           │ │
│  │    (futuro)              │      │                          │ │
│  └────────────────────────┘      └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                             │
                  HTTPS + Bearer Token (Sanctum)
                             │
                    ┌────────▼───────┐
                    │  Laravel API   │
                    │ /api/v1/kiosk/ │
                    └────────┬───────┘
                             │
              ┌──────────────▼──────────────┐
              │  orvian-facial-recognition   │
              │  FastAPI + face_recognition  │
              │  (microservicio Python)      │
              └──────────────────────────────┘
```

El **proceso principal** (Node.js) gestiona: persistencia de configuración en `%APPDATA%` via `electron-store`, validación de PIN con `bcryptjs`, y en el futuro el acceso a lectores de hardware (huella digital) vía `node-hid` o `serialport`. El **proceso de renderizado** (Chromium) gestiona: la cámara, el bucle de detección facial con MediaPipe Tasks-Vision, la UI y las peticiones HTTP al API de Laravel.

---

## 🛠️ Stack tecnológico

| Componente | Tecnología | Nota |
| :--- | :--- | :--- |
| Runtime de escritorio | `electron` | Empaqueta Chromium + Node.js en un único `.exe` |
| Detección facial | `@mediapipe/tasks-vision` | WASM + modelo `.tflite` servidos desde disco local |
| Captura de cámara | `getUserMedia` (Web API) | Sin librerías adicionales |
| Estilos | `tailwindcss` (standalone build) | Mismo sistema de utilidades que el frontend Laravel |
| Persistencia | `electron-store` | Token, URL del servidor y PIN hash en `%APPDATA%` |
| Validación PIN | `bcryptjs` (proceso principal) | La comparación bcrypt nunca ocurre en el renderer |
| Empaquetado | `electron-builder` | Genera instalador NSIS `.exe` standalone para Windows |
| Auto-update | `electron-updater` | Feed de actualizaciones apuntando al servidor ORVIAN |

---

## 🖥️ Estados visuales del kiosko

La interfaz tiene cuatro estados que `ui-states.js` gestiona de forma centralizada:

| Estado | Descripción |
| :--- | :--- |
| `idle` | Cámara activa, esperando que un rostro entre en cuadro |
| `processing` | Rostro capturado, solicitud al servidor en progreso |
| `success` | Estudiante identificado — muestra nombre, foto y hora |
| `no_session` | No hay jornada activa — cámara apagada, modo pasivo |

Adicionalmente, `pin-gate.js` maneja el estado de **token revocado**: cuando el heartbeat recibe un `401`, detiene el ciclo normal y muestra la pantalla de PIN de técnico.

---

## 🔐 Autenticación y seguridad

### Token de kiosko (Sanctum)

Cada dispositivo opera con un **token individual** generado desde el panel de `SchoolSettings` en Laravel. El token se vincula a la institución (modelo `School`), no a un usuario. Las peticiones usan `Authorization: Bearer <token>` con `Accept: application/json` en todos los headers.

El token se guarda en `electron-store` al configurar el dispositivo por primera vez. Si el director revoca el token desde Laravel, el próximo heartbeat (30 segundos) recibirá un `401` y el kiosko entrará automáticamente en el flujo de PIN gate.

### PIN de técnico

El director puede configurar un PIN numérico (4-6 dígitos) desde `SchoolSettings` en Laravel. Este PIN se guarda hasheado con `bcrypt` en la tabla `schools`. Cada respuesta exitosa del endpoint `/status` incluye el `pin_hash`, que la app cachea en `electron-store`.

Cuando el token es revocado, el técnico debe ingresar este PIN para acceder al formulario de reconfiguración. La validación ocurre **localmente** en el proceso principal (Node.js + `bcryptjs`), sin requerir conexión al servidor.

> **Nota de flujo:** Si necesitas cambiar el PIN y revocar el token del mismo dispositivo, cambia el PIN primero y espera al menos 30 segundos para que el kiosko sincronice el nuevo hash antes de revocar.

---

## 📁 Estructura del repositorio

```
orvian-kiosk-electron/
├── package.json
├── electron-builder.yml          # Configuración del instalador NSIS
├── tailwind.config.js
│
├── main/
│   ├── main.js                   # Punto de entrada — crea BrowserWindow, registra IPC handlers
│   ├── config-store.js           # Wrapper de electron-store (server_url, kiosk_token, cached_pin_hash)
│   ├── preload.js                # contextBridge — expone orvianConfig al renderer de forma segura
│   └── hardware/
│       └── fingerprint.js        # Placeholder — futuro lector de huella vía node-hid
│
├── renderer/
│   ├── index.html                # Ventana única del kiosko (layout 70/30: cámara / panel)
│   ├── styles.css                # Output del build de Tailwind
│   ├── setup-screen.js           # Orquestador principal: init(), heartbeat, showConfigForm()
│   ├── camera.js                 # initFaceDetector() + detectLoop() con dwell time
│   ├── api-client.js             # ApiClient, TokenRevokedError, fetch con Bearer token
│   ├── ui-states.js              # UI.render() — controla los 4 estados del kiosko
│   └── pin-gate.js               # showPinGate() — pantalla de PIN para reconfiguración
│
├── vendor/
│   └── mediapipe/
│       ├── wasm/                 # Runtime WASM de MediaPipe Tasks-Vision (no se pide por red)
│       └── models/
│           └── blaze_face_short_range.tflite
│
└── assets/
    ├── sounds/
    │   ├── success.wav
    │   └── error.wav
    └── icons/
        └── orvian.ico
```

---

## ⚙️ Configuración inicial del dispositivo

No existe pantalla de login. Al primer arranque (o tras un token revocado), el técnico configura dos valores:

| Campo | Descripción | Ejemplo |
| :--- | :--- | :--- |
| URL del servidor | Dirección base del backend Laravel de la institución | `https://orvian.com.do` |
| Token de kiosko | Generado desde `SchoolSettings → Zona de Peligro` en ORVIAN | `1\|abc123...` |

Al guardar, la app hace una solicitud de prueba a `/api/v1/kiosk/status`. Si responde correctamente, la configuración se persiste en `%APPDATA%\orvian-kiosk\` y la app entra en modo operativo.

---

## 📦 Instalación y desarrollo

### Requisitos

- Node.js 18+
- npm 9+
- Windows (el empaquetado NSIS es solo para Windows — el kiosko está diseñado para PCs de portería)

### Instalar dependencias

```bash
npm install
```

### Copiar los assets de MediaPipe

Los archivos WASM y el modelo `.tflite` deben estar presentes en `vendor/mediapipe/` antes de correr la app. Copiarlos desde `node_modules`:

```bash
# WASM runtime
cp -r node_modules/@mediapipe/tasks-vision/wasm vendor/mediapipe/wasm

# Modelo de detección facial
mkdir -p vendor/mediapipe/models
cp node_modules/@mediapipe/tasks-vision/models/blaze_face_short_range.tflite vendor/mediapipe/models/
```

### Correr en modo desarrollo

```bash
npm start
```

### Build de Tailwind (si se modifican estilos)

```bash
npx tailwindcss -i ./renderer/src.css -o ./renderer/styles.css --watch
```

### Compilar el instalador

```bash
npm run build
# Genera: dist/ORVIAN-Kiosko-Setup-x.x.x.exe
```

El instalador incluye automáticamente la carpeta `vendor/mediapipe/` gracias al bloque `extraResources` en `electron-builder.yml`. No requiere ninguna instalación previa en la PC destino.

---

## 🔄 Auto-actualización

La app usa `electron-updater` apuntando al servidor ORVIAN como proveedor de actualizaciones. Al publicar una nueva versión:

1. Compilar con `npm run build`.
2. Subir el `.exe` y el `latest.yml` generados al endpoint configurado en Laravel (`/api/updates/kiosk/`).
3. Los dispositivos instalados detectarán la nueva versión en el próximo arranque y actualizarán silenciosamente en segundo plano.

La configuración en `%APPDATA%` (token, URL del servidor, PIN hash cacheado) **no se borra** al actualizar.

---

## 🔭 Extensibilidad futura

El acceso a hardware adicional está previsto en el proceso principal para mantener el renderer libre de dependencias nativas:

```javascript
// main/hardware/fingerprint.js
ipcMain.handle('fingerprint:scan', async () => {
    // SDK del lector (DigitalPersona, ZKTeco, etc.) vía node-hid o serialport
    // El renderer llama: await window.orvianConfig.scanFingerprint()
    // y recibe el resultado sin saber nada del hardware
});
```

Los lectores QR físicos (modo *keyboard wedge*) no requieren ningún código adicional — el sistema operativo los trata como un teclado y el input del kiosko los captura como texto.

---

## 🔗 Repositorios relacionados

| Repositorio | Descripción |
| :--- | :--- |
| [orvian](https://github.com/Elian-D/orvian) | Backend Laravel — API Gateway, gestión escolar, módulos académicos |
| [orvian-facial-recognition](https://github.com/Elian-D/orvian-facial-recogniton) | Microservicio Python — FastAPI + face_recognition (dlib) |