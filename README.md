# ORVIAN Kiosko
## Cliente de escritorio para registro de asistencia biométrica

Parte del ecosistema **[ORVIAN](https://github.com/Elian-D/orvian)** — Sistema Integral de Gestión Educativa para instituciones dominicanas.

---

## 📋 Tabla de contenidos

- [Descripción general](#-descripción-general)
- [Arquitectura](#️-arquitectura)
- [Stack tecnológico](#️-stack-tecnológico)
- [Modos de operación](#-modos-de-operación)
- [Estados visuales](#️-estados-visuales-del-kiosko)
- [Autenticación y seguridad](#-autenticación-y-seguridad)
- [Estructura del repositorio](#-estructura-del-repositorio)
- [Configuración inicial](#️-configuración-inicial-del-dispositivo)
- [Instalación y desarrollo](#-instalación-y-desarrollo)
- [Auto-actualización](#-auto-actualización)
- [Extensibilidad futura](#-extensibilidad-futura)
- [Repositorios relacionados](#-repositorios-relacionados)

---

## 📌 Descripción general

**orvian-kiosk-electron** es la aplicación de escritorio que opera como terminal física de registro de asistencia en la portería de un centro educativo. Soporta dos métodos de registro independientes:

- **Lector QR/barras USB** (*keyboard wedge*) — método principal, velocidad instantánea, sin cámara.
- **Reconocimiento facial** (MediaPipe + microservicio Python) — método biométrico opcional para planes avanzados.

La aplicación detecta automáticamente qué métodos tiene habilitados el plan de la institución consultando el servidor al iniciar, y adapta su interfaz en consecuencia — sin configuración manual.

Todas las dependencias de visión artificial (modelos `.tflite`, runtime `.wasm`) viajan **empaquetadas dentro del instalador**, sin pedir nada a CDNs externos. La única comunicación de red es la que tiene con el servidor ORVIAN propio de la institución.

> **Contexto del pivote arquitectónico:** Las versiones anteriores intentaban ejecutar el procesamiento de visión en el navegador web. Dos problemas estructurales lo hicieron inviable en redes escolares dominicanas: los archivos WASM de MediaPipe (~18 MB) son bloqueados por firewalls Fortinet, y las fugas de memoria de `getUserMedia` + WASM en sesiones largas son difíciles de mitigar en producción. Electron resuelve ambos: los WASM viajan dentro del instalador y el proceso de renderizado tiene un ciclo de vida controlado.

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
│  │    (futuro)              │      │  • qr-listener.js        │ │
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

El **proceso principal** (Node.js) gestiona: persistencia de configuración en `%APPDATA%` via `electron-store`, validación de PIN con `bcryptjs`, y en el futuro el acceso a lectores de hardware adicionales (huella digital) vía `node-hid` o `serialport`. El **proceso de renderizado** (Chromium) gestiona: la cámara, el bucle de detección facial con MediaPipe Tasks-Vision, el listener del lector QR USB, la UI y las peticiones HTTP al API de Laravel.

---

## 🛠️ Stack tecnológico

| Componente | Tecnología | Nota |
| :--- | :--- | :--- |
| Runtime de escritorio | `electron` | Empaqueta Chromium + Node.js en un único `.exe` |
| Lector QR/barras | Wedge HID nativo | No requiere librería — el SO lo trata como teclado |
| Detección facial | `@mediapipe/tasks-vision` | WASM + modelo `.tflite` servidos desde disco local |
| Captura de cámara | `getUserMedia` (Web API) | Sin librerías adicionales |
| Estilos | `tailwindcss` (standalone build) | Mismo sistema de utilidades que el frontend Laravel |
| Persistencia | `electron-store` | Token, URL del servidor y PIN hash en `%APPDATA%` |
| Validación PIN | `bcryptjs` (proceso principal) | La comparación bcrypt nunca ocurre en el renderer |
| Empaquetado | `electron-builder` | Genera instalador NSIS `.exe` standalone para Windows |
| Auto-update | `electron-updater` | Feed de actualizaciones apuntando al servidor ORVIAN |

---

## 🎛️ Modos de operación

El kiosko no requiere configuración manual del modo. Al iniciar y en cada heartbeat (30 segundos), consulta `GET /api/v1/kiosk/status`. La respuesta incluye qué features tiene habilitadas el plan de la escuela:

```json
{
  "features": {
    "attendance_qr": true,
    "attendance_facial": false
  }
}
```

Basado en esa respuesta, `setup-screen.js` activa automáticamente el modo correspondiente:

| `attendance_facial` | `attendance_qr` | Modo activo |
| :---: | :---: | :--- |
| ✅ | ✅ | **Facial + QR** — cámara encendida, lector escuchando en paralelo |
| ❌ | ✅ | **QR solamente** — cámara apagada, interfaz minimalista de lector |
| ❌ | ❌ | Sin features — pantalla de sesión inactiva |

### Modo QR solamente

Cuando el plan solo incluye `attendance_qr`, la interfaz reemplaza el visor de cámara con un panel minimalista. No se enciende ninguna cámara, el consumo de CPU es mínimo, y el lector USB opera de forma completamente independiente. La velocidad de registro en este modo es prácticamente instantánea — el tiempo de respuesta está limitado solo por la latencia de red al servidor.

### Modo Facial + QR

Cuando el plan incluye `attendance_facial`, la cámara se enciende y MediaPipe corre el bucle de detección. El lector QR sigue escuchando en paralelo — ambos métodos están activos simultáneamente. Un estudiante puede acercar su carnet al lector o simplemente pararse frente a la cámara; el primero en completarse registra la asistencia.

### Cómo funciona el lector QR USB

Los lectores QR y de barras en modo *keyboard wedge* (el modo estándar de fábrica) no requieren driver ni SDK. El sistema operativo los registra como un teclado HID. Al escanear un código, el lector tipea el contenido en milisegundos, seguido opcionalmente de `Enter`.

`qr-listener.js` mantiene un `<input>` oculto con foco permanente que acumula esos caracteres en un buffer. El buffer se procesa por dos vías:

- **Enter recibido** — algunos lectores envían `Enter` al final. El buffer se procesa inmediatamente.
- **Silencio de 150ms** — si el lector no envía `Enter`, el buffer se procesa tras 150ms de inactividad. Un lector USB típicamente envía todos los caracteres de un código en menos de 50ms, por lo que este silencio es inequívoco.

Un código mínimo de 3 caracteres previene que pulsaciones accidentales se interpreten como escaneos.

---

## 🖥️ Estados visuales del kiosko

`ui-states.js` centraliza todos los estados de la interfaz:

| Estado | Descripción |
| :--- | :--- |
| `idle` | Cámara activa, esperando que un rostro entre en cuadro |
| `qr_only` | Panel QR minimalista, cámara apagada, lector escuchando |
| `processing` | Solicitud al servidor en progreso |
| `success` | Estudiante registrado — muestra nombre, foto y hora |
| `error` | Error de identificación — mensaje específico por 1.5 segundos |
| `no_session` | Sin jornada activa — cámara apagada, modo pasivo |

`pin-gate.js` maneja adicionalmente el estado de **token revocado**: cuando el heartbeat recibe un `401`, el kiosko detiene todo y muestra la pantalla de PIN de técnico.

---

## 🔐 Autenticación y seguridad

### Token de kiosko (Sanctum)

Cada dispositivo opera con un **token individual** generado desde el panel `SchoolSettings → Zona de Peligro` en Laravel. El token se vincula a la institución (modelo `School`), no a un usuario. Las peticiones usan `Authorization: Bearer <token>` con `Accept: application/json`.

El token se guarda en `electron-store` al configurar el dispositivo. Si el director lo revoca desde Laravel, el próximo heartbeat recibirá un `401` y el kiosko entrará automáticamente en el flujo de PIN gate.

### PIN de técnico

El director configura un PIN numérico (4-6 dígitos) desde `SchoolSettings` en Laravel. Se guarda hasheado con `bcrypt` en la tabla `schools`. Cada respuesta exitosa del endpoint `/status` incluye el `pin_hash`, que la app cachea en `electron-store`.

Cuando el token es revocado, el técnico ingresa el PIN para acceder al formulario de reconfiguración. La validación ocurre **localmente** en el proceso principal (Node.js + `bcryptjs`) — sin requerir conexión al servidor en ese momento.

> **Nota operativa:** Si necesitas cambiar el PIN y revocar el token del mismo dispositivo, cambia el PIN primero y espera al menos 30 segundos para que el kiosko sincronice el nuevo hash antes de revocar.

### Acceso técnico

Un botón de engranaje discreto (baja opacidad, visible al hover) está fijo en la esquina inferior derecha de la interfaz. Al pulsarlo se solicita el PIN de técnico antes de mostrar el formulario de configuración. Permite corregir la URL del servidor o el token sin necesidad de acceder a `%APPDATA%` manualmente.

---

## 📁 Estructura del repositorio

```
orvian-kiosk-electron/
├── package.json
├── electron-builder.yml          # Configuración del instalador NSIS
├── tailwind.config.js
│
├── main/
│   ├── main.js                   # Punto de entrada — BrowserWindow, IPC handlers, auto-updater
│   ├── config-store.js           # electron-store (server_url, kiosk_token, cached_pin_hash)
│   ├── preload.js                # contextBridge — expone orvianConfig al renderer
│   └── hardware/
│       └── fingerprint.js        # Placeholder — futuro lector de huella vía node-hid
│
├── renderer/
│   ├── index.html                # Ventana única del kiosko (layout 70/30: cámara / panel)
│   ├── styles.css                # Output del build de Tailwind
│   ├── setup-screen.js           # Orquestador: init(), heartbeat, activateKioskMode()
│   ├── camera.js                 # initFaceDetector() + detectLoop() con dwell time
│   ├── qr-listener.js            # Buffer de lector USB wedge, doble estrategia Enter/timeout
│   ├── api-client.js             # ApiClient — recordFacial(), recordQr(), getStatus()
│   ├── ui-states.js              # UI.render() — todos los estados visuales del kiosko
│   └── pin-gate.js               # showPinGate() — pantalla de PIN para reconfiguración
│
├── vendor/
│   └── mediapipe/
│       ├── wasm/                 # Runtime WASM de MediaPipe (sin CDN)
│       └── models/
│           └── blaze_face_short_range.tflite
│
└── assets/
    ├── sounds/
    │   ├── success.wav           # Feedback de éxito (volumen 80%)
    │   └── error.wav             # Feedback de error (volumen 30%)
    └── icons/
        └── orvian.ico
```

---

## ⚙️ Configuración inicial del dispositivo

No existe pantalla de login. Al primer arranque el técnico configura dos valores:

| Campo | Descripción | Ejemplo |
| :--- | :--- | :--- |
| URL del servidor | Dirección base del backend Laravel | `https://orvian.com.do` |
| Token de kiosko | Generado desde `SchoolSettings → Zona de Peligro` | `1\|abc123...` |

Al guardar, la app verifica la conexión con `/api/v1/kiosk/status`. Si responde correctamente, la configuración se persiste en `%APPDATA%\orvian-kiosk\` y la app entra en modo operativo. Los datos de configuración **no se borran** al actualizar la app.

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

Los archivos WASM y el modelo `.tflite` deben estar presentes en `vendor/mediapipe/` antes de correr la app:

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

Las DevTools se abren automáticamente en desarrollo (`NODE_ENV=development`). En producción se deshabilitan excepto con `Ctrl+Shift+I`.

### Build de Tailwind

```bash
npx tailwindcss -i ./renderer/src.css -o ./renderer/styles.css --watch
```

### Compilar el instalador

```bash
npm run build
# Genera: dist/Orvian-Kiosko-x.x.x.exe
```

El bloque `extraResources` en `electron-builder.yml` garantiza que `vendor/mediapipe/` y `assets/` viajen dentro del instalador. No requiere instalación previa en la PC destino.

> **Antes de compilar para distribución:** establecer `DEBUG_ENABLED = false` en `qr-listener.js` para ocultar el panel de debug del lector QR.

---

## 🔄 Auto-actualización

La app usa `electron-updater` apuntando hacia el GitHub Releases como proveedor. Al publicar una nueva versión:

1. Compilar con `npm run build`.
2. Subir el `.exe` y el `latest.yml` generados al release de github (`/api/updates/kiosk/`).
3. Los dispositivos detectarán la nueva versión en el próximo arranque y actualizarán silenciosamente.

La configuración en `%APPDATA%` sobrevive a las actualizaciones.

---

## 🔭 Extensibilidad futura

El acceso a hardware adicional está previsto en el proceso principal:

```javascript
// main/hardware/fingerprint.js
ipcMain.handle('fingerprint:scan', async () => {
    // SDK del lector (DigitalPersona, ZKTeco, etc.) vía node-hid o serialport
    // El renderer llama: await window.orvianConfig.scanFingerprint()
});
```

Agregar un nuevo método de registro (huella, tarjeta NFC) no requiere tocar el renderer — solo agregar el handler IPC en el proceso principal y exponer la función via `preload.js`.

---

## 🔗 Repositorios relacionados

| Repositorio | Descripción |
| :--- | :--- |
| [orvian](https://github.com/Elian-D/orvian) | Backend Laravel — API Gateway, gestión escolar, módulos académicos |
| [orvian-facial-recognition](https://github.com/Elian-D/orvian-facial-recogniton) | Microservicio Python — FastAPI + face_recognition (dlib) |