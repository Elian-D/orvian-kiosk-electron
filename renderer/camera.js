// renderer/camera.js

const DWELL_REQUIRED_MS = 1000;
const MIN_DETECTION_CONFIDENCE = 0.6;

let faceDetector = null;
let dwellStart = null;

export async function initFaceDetector() {
    const { FaceDetector, FilesetResolver } = await import('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
    const vision = await FilesetResolver.forVisionTasks("../vendor/mediapipe/wasm");

    faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "../vendor/mediapipe/models/blaze_face_short_range.tflite",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
    });
    console.log("MediaPipe Face Detector inicializado correctamente localmente.");
}

export function detectLoop(videoEl, canvasEl, onCaptureReady) {
    const ctx = canvasEl.getContext("2d");

    function loop() {
        // SI LA CÁMARA ESTÁ APAGADA: Limpiar canvas y pausar inferencia (Consumo CPU cercano a 0%)
        if (!faceDetector || !videoEl.srcObject || videoEl.readyState < 2) {
            ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
            return requestAnimationFrame(loop);
        }

        if (canvasEl.width !== videoEl.videoWidth) {
            canvasEl.width = videoEl.videoWidth;
            canvasEl.height = videoEl.videoHeight;
        }

        // Leer el estado actual guardado en el dataset del contenedor de UI
        const appState = document.getElementById('app')?.dataset.state;

        // SOLO HACER INFERENCE SI LA UI ESTÁ EN ESPERA ('idle')
        if (appState === 'idle') {
            const result = faceDetector.detectForVideo(videoEl, performance.now());
            ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

            if (result.detections && result.detections.length === 1) {
                const box = result.detections[0].boundingBox;
                drawFaceBox(ctx, box);

                const now = Date.now();
                if (!dwellStart) dwellStart = now;
                const progress = Math.min((now - dwellStart) / DWELL_REQUIRED_MS, 1);

                if (progress >= 1) {
                    dwellStart = null;
                    onCaptureReady(videoEl); 
                }
            } else {
                dwellStart = null;
            }
        } else {
            // Si está procesando o mostrando éxito, limpiamos el canvas y reiniciamos el tiempo de espera
            ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
            dwellStart = null;
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

function drawFaceBox(ctx, box) {
    const cornerRadius = 20; // Ajusta esto para más o menos redondeo
    const padding = 20;      // Ajusta esto para hacerlo más ancho/alto respecto al rostro

    // Calculamos las dimensiones ajustadas
    const x = box.originX - padding;
    const y = box.originY - padding;
    const width = box.width + (padding * 2);
    const height = box.height + (padding * 2);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 6; // Mayor grosor para que se vea más profesional
    ctx.beginPath();
    
    // Usamos roundRect para esquinas redondeadas (Soportado en la mayoría de navegadores modernos)
    ctx.roundRect(x, y, width, height, cornerRadius);
    
    ctx.stroke();
}