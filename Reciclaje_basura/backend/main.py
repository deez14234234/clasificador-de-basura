"""API de clasificacion de residuos segun el codigo de colores NTP 900.058.

Endpoints:
    GET  /api/health     estado del servicio y del modelo
    GET  /api/classes    taxonomia completa (8 materiales, 7 contenedores)
    POST /api/predict    una foto -> material, contenedor y confianza

Arranque:
    python backend/main.py                 # escucha en 0.0.0.0:8000
    uvicorn backend.main:app --reload
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import time
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE / "backend"))

from inference import (Clasificador, ImagenInvalida,      # noqa: E402
                       ModelNotReady, DEFAULT_UMBRAL)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("reciclaje")

# Las fotos del S24 Ultra pueden pasar de 20 MB; el limite corta subidas
# absurdas antes de gastar memoria decodificandolas.
MAX_BYTES = int(os.getenv("RECICLAJE_MAX_MB", "12")) * 1024 * 1024
UMBRAL = float(os.getenv("RECICLAJE_UMBRAL", str(DEFAULT_UMBRAL)))
# Permite servir otro modelo sin tocar codigo: por ejemplo el ONNX int8 de
# la Raspberry Pi, para que la app movil use exactamente el mismo que el
# dispositivo.
MODELO = os.getenv("RECICLAJE_MODELO")
META = os.getenv("RECICLAJE_META")

estado: dict[str, Any] = {"clasificador": None, "error": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # El modelo se carga una vez al arrancar, no por peticion. Si no esta
    # exportado todavia, el servidor igual levanta y /api/health lo explica,
    # que es mas util que un arranque fallido sin mensaje.
    try:
        extra = {}
        if MODELO:
            extra["model_path"] = Path(MODELO)
        if META:
            extra["meta_path"] = Path(META)
        estado["clasificador"] = Clasificador(umbral=UMBRAL, **extra)
        log.info("Modelo cargado: %s", estado["clasificador"].info)
    except ModelNotReady as exc:
        estado["error"] = str(exc)
        log.error("Modelo no disponible: %s", exc)
    yield


app = FastAPI(
    title="Clasificador de residuos NTP 900.058",
    description="Clasifica una foto de un residuo y devuelve el color de "
                "contenedor del codigo de colores ampliado.",
    version="1.0.0",
    lifespan=lifespan,
)

# La app de Expo corre en el telefono y pega a la IP de la laptop, asi que el
# origen no es predecible: se permite cualquiera. Es una API local de lectura,
# sin credenciales ni datos propios.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def clasificador() -> Clasificador:
    clf = estado["clasificador"]
    if clf is None:
        raise HTTPException(503, detail=estado["error"] or "Modelo no cargado")
    return clf


@app.get("/api/health")
def health() -> dict[str, Any]:
    clf = estado["clasificador"]
    return {
        "estado": "ok" if clf else "sin_modelo",
        "detalle": estado["error"],
        "modelo": clf.info if clf else None,
        "max_mb": MAX_BYTES // (1024 * 1024),
    }


@app.get("/api/classes")
def classes() -> dict[str, Any]:
    clf = clasificador()
    return clf.meta["taxonomy"]


# Estado del registro resumido del modo en vivo.
_vivo = {"n": 0, "ultimo": 0.0, "ms": 0.0}
INTERVALO_LOG_VIVO = 2.0   # segundos entre lineas de resumen


def _log_vivo(material: str, confianza: float, ms: float) -> None:
    """Una linea cada pocos segundos en vez de una por fotograma.

    La vista en vivo manda varios fotogramas por segundo; registrarlos uno a
    uno llena la terminal y esconde lo que si importa, como un error puntual.
    """
    ahora = time.monotonic()
    if _vivo["ultimo"] == 0.0:
        # Primer fotograma de la sesion: solo abre la ventana. Registrar aqui
        # daria una linea de "1 fotograma" sin ritmo que medir.
        _vivo.update(n=1, ultimo=ahora, ms=ms)
        return

    _vivo["n"] += 1
    _vivo["ms"] += ms
    transcurrido = ahora - _vivo["ultimo"]
    if transcurrido < INTERVALO_LOG_VIVO:
        return

    log.info("vivo: %d fotogramas (%.1f/s, %.0f ms de media) | ultimo: %s %.0f%%",
             _vivo["n"], _vivo["n"] / transcurrido, _vivo["ms"] / _vivo["n"],
             material, confianza * 100)
    _vivo.update(n=0, ultimo=ahora, ms=0.0)


def _clasificar_bytes(raw: bytes, tta: bool, topk: int, via: str,
                      vivo: bool = False) -> dict[str, Any]:
    """Logica comun a las dos formas de enviar la foto."""
    clf = clasificador()

    if not raw:
        raise HTTPException(400, detail="La imagen llego vacia.")
    if len(raw) > MAX_BYTES:
        raise HTTPException(
            413,
            detail=f"La imagen pesa {len(raw) / (1024 * 1024):.1f} MB y el limite es "
                   f"{MAX_BYTES // (1024 * 1024)} MB. "
                   "Reduce la resolucion antes de subirla.",
        )

    try:
        pred = clf.predecir(raw, tta=tta, topk=topk)
    except ImagenInvalida as exc:
        raise HTTPException(400, detail=str(exc)) from exc

    colores = {c["key"]: c for c in clf.meta["taxonomy"]["colores"]}
    bin_ = colores[pred.color]

    if vivo:
        _log_vivo(pred.material, pred.confianza, pred.ms)
    else:
        log.info("predict(%s) material=%s conf=%.3f incierto=%s %.0fms",
                 via, pred.material, pred.confianza, pred.incierto, pred.ms)

    return {
        "material": pred.material,
        "material_label": pred.material_label,
        "confianza": pred.confianza,
        "incierto": pred.incierto,
        "contenedor": {
            "color": bin_["key"],
            "nombre": bin_["nombre"],
            "residuos": bin_["residuos"],
            "hex": bin_["hex"],
            "texto_hex": bin_["texto_hex"],
        },
        "consejo": clf.tip(pred.material),
        "top": pred.top,
        "ms": pred.ms,
        "mensaje": ("No estoy seguro; vuelve a tomar la foto mas cerca y con "
                    "buena luz." if pred.incierto else None),
    }


@app.post("/api/predict")
async def predict(
    file: UploadFile = File(..., description="foto del residuo (jpg/png)"),
    tta: bool = Query(False, description="promedia con el espejo horizontal"),
    topk: int = Query(3, ge=1, le=8),
) -> dict[str, Any]:
    """Subida multipart. Es la forma comoda desde curl, la pagina /docs o
    cualquier cliente HTTP normal."""
    return _clasificar_bytes(await file.read(), tta, topk, "multipart")


class ImagenBase64(BaseModel):
    imagen_base64: str


@app.post("/api/predict-base64")
async def predict_base64(
    cuerpo: ImagenBase64,
    tta: bool = Query(False, description="promedia con el espejo horizontal"),
    topk: int = Query(3, ge=1, le=8),
    vivo: bool = Query(False, description="fotograma de la vista en vivo: log resumido"),
) -> dict[str, Any]:
    """Misma prediccion, con la imagen en base64 dentro de un JSON.

    Existe por la app de React Native: desde la version 0.88, su stack de red
    rechaza el objeto {uri, name, type} que se usaba para armar un multipart
    ("Unsupported FormDataPart implementation") y exige un Blob real, que no
    hay forma directa de obtener desde un file:// del telefono. Mandar la
    imagen en base64 evita el multipart por completo y funciona igual en
    cualquier version. Cuesta un 33 % mas de bytes, despreciable para fotos ya
    reducidas a ~60 KB.
    """
    datos = cuerpo.imagen_base64
    # Acepta tambien el formato data:image/jpeg;base64,<...> de los navegadores.
    if datos.startswith("data:"):
        _, _, datos = datos.partition(",")

    try:
        raw = base64.b64decode(datos, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, detail=f"base64 invalido: {exc}") from exc

    return _clasificar_bytes(raw, tta, topk, "base64", vivo=vivo)


@app.get("/")
def raiz() -> JSONResponse:
    return JSONResponse({
        "servicio": "Clasificador de residuos NTP 900.058",
        "docs": "/docs",
        "endpoints": ["/api/health", "/api/classes", "/api/predict"],
    })


def ip_de_salida() -> str:
    """IP de la interfaz por la que sale el trafico: casi siempre la del router."""
    import socket

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


def direcciones_ipv4(principal: str) -> list[tuple[str, str]]:
    """Todas las IPv4 del equipo, con una nota sobre para que sirve cada una.

    Esta maquina tiene varias interfaces (Wi-Fi, hotspot de Windows, VirtualBox,
    WSL). Anunciar solo una lleva a escribir en el telefono una direccion de
    otra red que nunca va a responder.

    La unica senal fiable de cual es la buena es cual usa el sistema para salir
    a internet; el rango de la IP no lo dice. 172.20.x.x parece de Docker por el
    prefijo y puede ser perfectamente la Wi-Fi, asi que etiquetar por prefijo
    --como se hacia antes-- marcaba como inservible justo la direccion correcta.
    Solo se etiquetan los dos casos que si son inequivocos.
    """
    import socket

    conocidas = {
        "192.168.137.": "hotspot de Windows",
        "192.168.56.": "VirtualBox",
        "169.254.": "sin conexion",
    }

    ips: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    if principal and principal not in ips:
        ips.append(principal)

    salida = []
    for ip in sorted(ips):
        if ip == principal:
            nota = "tu red actual"
        else:
            nota = next((n for p, n in conocidas.items() if ip.startswith(p)),
                        "otra interfaz")
        salida.append((ip, nota))
    return salida


def main() -> None:
    import socket
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    principal = ip_de_salida()

    # Comprobar el puerto antes de cargar nada: si esta ocupado, uvicorn falla
    # despues de tener el modelo en la GPU y con un error de socket de Windows
    # que no dice como arreglarlo.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("0.0.0.0", port))
        except OSError:
            print(f"\nEl puerto {port} ya esta ocupado por otro programa.")
            print("Arranca en otro puerto, por ejemplo:")
            print("    $env:PORT = '8008'")
            print("    python backend\\main.py")
            print("\nPara ver que lo esta usando:")
            print(f"    Get-NetTCPConnection -State Listen -LocalPort {port}")
            raise SystemExit(1)

    print("=" * 66)
    print("  API lista. Direcciones por las que el telefono puede entrar:")
    for ip, nota in direcciones_ipv4(principal):
        marca = "  <-- usa esta" if ip == principal else ""
        print(f"    http://{ip}:{port}   ({nota}){marca}")
    print()
    print("  Tiene que estar en la MISMA red que el telefono.")
    print("  Si el telefono esta en el hotspot de la laptop, es la 192.168.137.1")
    if principal:
        print(f"  Documentacion interactiva: http://{principal}:{port}/docs")
    print("=" * 66)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
