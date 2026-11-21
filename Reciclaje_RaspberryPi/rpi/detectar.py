#!/usr/bin/env python3
"""Clasificador de residuos NTP 900.058 en Raspberry Pi 4 con camara web.

Mismo flujo que la app movil del proyecto:

  1. La camara lee en vivo y suaviza las probabilidades fotograma a fotograma.
  2. Cuando la lectura es firme (el mismo material durante ~1 s y confianza de
     al menos 60 %) captura sola: analiza ese cuadro con TTA (original +
     espejo, como el backend) y muestra el resultado con el tacho del color
     que corresponde, durante unos segundos.
  3. Solo vuelve a disparar cuando cambia el objeto o se aparta la camara.

Teclas (con ventana): ESPACIO captura ya / cierra el resultado, Q o ESC sale.
Sin ventana (--headless): ENTER captura ya, Ctrl+C sale.

Cada resultado se anota en historial.csv (y la foto en capturas/ con
--guardar-fotos).

Autocontenido a proposito: solo necesita numpy, opencv y onnxruntime. No
importa nada del codigo de entrenamiento, asi que basta copiar esta carpeta.

Uso:
    python3 detectar.py                       # ventana con la camara
    python3 detectar.py --pantalla-completa   # para un monitor dedicado
    python3 detectar.py --headless            # por consola, para SSH
    python3 detectar.py --rapido              # modelo int8, mas fotogramas
    python3 detectar.py --fuente 1 --hilos 4
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import platform
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

# --- Preprocesamiento -------------------------------------------------------
# Tiene que coincidir exactamente con el del entrenamiento (ml/imaging.py):
# encajar en 240x240 rellenando con reflejo, recortar el centro a 224 y
# normalizar con la media de ImageNet. Si aqui se recortara el centro de un
# fotograma 640x480, el modelo veria imagenes de un dominio distinto al que
# aprendio y fallaria sin dar ninguna senal de que algo va mal.
TAM_AJUSTE = 240
MEDIA = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DESV = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# --- Comportamiento: los mismos valores que la app movil y el backend ------
ALFA = 0.45               # peso de la lectura nueva en el suavizado
ESTABLE_S = 1.0           # segundos con el mismo material para darlo por estable
CONFIANZA_FIRME = 0.60    # lectura firme: dispara la captura automatica
CONFIANZA_SUELTA = 0.45   # por debajo, se considera que se aparto la camara
UMBRAL_DUDA = 0.55        # como el backend: por debajo el resultado es "dudoso"
SEGUNDOS_RESULTADO = 4.0  # cuanto se muestra el resultado antes de seguir

NEON = (50, 244, 198)     # #C6F432 en BGR
FONDO = (13, 9, 7)        # #07090D en BGR
TEXTO = (249, 246, 243)
TEXTO_SUAVE = (179, 162, 152)
AVISO = (32, 176, 255)


def ajustar_con_reflejo(bgr: np.ndarray, tam: int = TAM_AJUSTE) -> np.ndarray:
    """Encaja la imagen en un cuadrado rellenando con reflejo, sin recortar.

    BORDER_REFLECT_101 es el modo "reflect" de numpy que usa el entrenamiento:
    refleja sin repetir el pixel del borde.
    """
    h, w = bgr.shape[:2]
    escala = tam / max(w, h)
    nw, nh = max(1, round(w * escala)), max(1, round(h * escala))
    # INTER_AREA es el remuestreo correcto al reducir: promedia en vez de
    # tomar muestras sueltas, que es lo que produce bordes dentados.
    interp = cv2.INTER_AREA if escala < 1 else cv2.INTER_CUBIC
    img = cv2.resize(bgr, (nw, nh), interpolation=interp)
    arriba, izq = (tam - nh) // 2, (tam - nw) // 2
    return cv2.copyMakeBorder(img, arriba, tam - nh - arriba, izq, tam - nw - izq,
                              cv2.BORDER_REFLECT_101)


def preparar(bgr: np.ndarray, recorte: int) -> np.ndarray:
    cuadro = ajustar_con_reflejo(bgr)
    inicio = (TAM_AJUSTE - recorte) // 2
    cuadro = cuadro[inicio:inicio + recorte, inicio:inicio + recorte]
    rgb = cv2.cvtColor(cuadro, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = (rgb - MEDIA) / DESV
    return np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def sin_tildes(texto: str) -> str:
    """OpenCV solo dibuja ASCII con sus fuentes Hershey."""
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()


def hex_a_bgr(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


def tono_visible(bgr: tuple[int, int, int]) -> tuple[int, int, int]:
    """El tacho negro desaparece sobre fondo oscuro: para textos y brillos se
    usa un gris claro. Misma regla que la app."""
    b, g, r = (c / 255 for c in bgr)
    luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # 0,2 deja fuera al negro NTP (#212121, ~0,13) y conserva el gris y el
    # marron (~0,46 y ~0,32).
    return (214, 206, 201) if luminancia < 0.2 else bgr


# --- Modelo -----------------------------------------------------------------

class Clasificador:
    def __init__(self, modelo: Path, meta: Path, hilos: int) -> None:
        self.meta = json.loads(meta.read_text(encoding="utf-8"))
        self.clases: list[str] = self.meta["classes"]
        self.recorte: int = int(self.meta["img_size"])
        self.material_a_color: dict[str, str] = self.meta["material_to_color"]
        self.etiquetas: dict[str, str] = self.meta.get("material_label", {})
        self.consejos: dict[str, str] = self.meta.get("material_tip", {})
        self.colores = {c["key"]: c for c in self.meta["taxonomy"]["colores"]}

        opciones = ort.SessionOptions()
        opciones.intra_op_num_threads = hilos
        opciones.inter_op_num_threads = 1
        opciones.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.ses = ort.InferenceSession(str(modelo), opciones,
                                        providers=["CPUExecutionProvider"])
        self.entrada = self.ses.get_inputs()[0].name

        self.acumulado: np.ndarray | None = None
        self.lider: str | None = None
        self.lider_desde = 0.0
        self._calentar()

    def reiniciar(self) -> None:
        """Olvida el historial del suavizado."""
        self.acumulado = None
        self.lider = None

    def _calentar(self) -> None:
        x = np.zeros((1, 3, self.recorte, self.recorte), dtype=np.float32)
        for _ in range(3):
            self.ses.run(None, {self.entrada: x})

    def _logits(self, x: np.ndarray) -> np.ndarray:
        return self.ses.run(None, {self.entrada: x})[0][0].astype(np.float32)

    def _ficha(self, material: str) -> dict:
        return {
            "material": material,
            "etiqueta": self.etiquetas.get(material, material),
            "contenedor": self.colores[self.material_a_color[material]],
            "consejo": self.consejos.get(material, ""),
        }

    def clasificar(self, bgr: np.ndarray) -> dict:
        """Lectura en vivo: un fotograma, suavizado con los anteriores."""
        t0 = time.perf_counter()
        x = preparar(bgr, self.recorte)
        t_prep = (time.perf_counter() - t0) * 1000

        t1 = time.perf_counter()
        probs = softmax(self._logits(x))
        t_inf = (time.perf_counter() - t1) * 1000

        # El primer fotograma inicializa el promedio en vez de mezclarse con
        # ceros: si no, la confianza arranca en 0,45 veces la real.
        if self.acumulado is None:
            self.acumulado = probs
        else:
            self.acumulado = ALFA * probs + (1 - ALFA) * self.acumulado
        i = int(self.acumulado.argmax())
        material = self.clases[i]

        ahora = time.monotonic()
        if material != self.lider:
            self.lider, self.lider_desde = material, ahora
        estabilidad = min(1.0, (ahora - self.lider_desde) / ESTABLE_S)

        return {
            **self._ficha(material),
            "confianza": float(self.acumulado[i]),
            "estabilidad": estabilidad,
            "ms_prep": t_prep,
            "ms_inferencia": t_inf,
        }

    def analizar(self, bgr: np.ndarray, topk: int = 3) -> dict:
        """Veredicto de una captura, con TTA como el backend: promedia los
        logits de la imagen y de su espejo horizontal."""
        t0 = time.perf_counter()
        x = preparar(bgr, self.recorte)
        logits = (self._logits(x) + self._logits(np.ascontiguousarray(x[:, :, :, ::-1]))) / 2
        probs = softmax(logits)
        orden = np.argsort(probs)[::-1][:topk]
        mejor = self.clases[int(orden[0])]
        conf = float(probs[int(orden[0])])
        return {
            **self._ficha(mejor),
            "confianza": conf,
            "incierto": conf < UMBRAL_DUDA,
            "top": [
                {
                    "material": self.clases[int(i)],
                    "etiqueta": self.etiquetas.get(self.clases[int(i)], self.clases[int(i)]),
                    "contenedor": self.colores[self.material_a_color[self.clases[int(i)]]],
                    "probabilidad": float(probs[int(i)]),
                }
                for i in orden
            ],
            "ms": (time.perf_counter() - t0) * 1000,
        }


# --- Dibujo -----------------------------------------------------------------

def mezclar(img: np.ndarray, capa: np.ndarray, alfa: float) -> None:
    cv2.addWeighted(capa, alfa, img, 1 - alfa, 0, img)


def texto(img, s, org, escala, color, grosor=1, sombra=True):
    s = sin_tildes(s)
    if sombra:
        # Mismo grosor que el texto: con un trazo mas grueso algunas versiones
        # de OpenCV cambian el ancho de las letras y la sombra se descuadra.
        cv2.putText(img, s, (org[0] + 2, org[1] + 2), cv2.FONT_HERSHEY_SIMPLEX,
                    escala, (0, 0, 0), grosor, cv2.LINE_AA)
    cv2.putText(img, s, org, cv2.FONT_HERSHEY_SIMPLEX, escala, color, grosor, cv2.LINE_AA)


def ancho_texto(s: str, escala: float, grosor: int = 1) -> int:
    return cv2.getTextSize(sin_tildes(s), cv2.FONT_HERSHEY_SIMPLEX, escala, grosor)[0][0]


def partir(s: str, ancho: int, escala: float) -> list[str]:
    lineas, actual = [], ""
    for palabra in sin_tildes(s).split():
        prueba = f"{actual} {palabra}".strip()
        if ancho_texto(prueba, escala) > ancho and actual:
            lineas.append(actual)
            actual = palabra
        else:
            actual = prueba
    if actual:
        lineas.append(actual)
    return lineas


def caja(img, p1, p2, color, alfa=0.7, radio=14):
    """Rectangulo redondeado semitransparente."""
    capa = img.copy()
    (x1, y1), (x2, y2) = p1, p2
    r = max(1, min(radio, (x2 - x1) // 2, (y2 - y1) // 2))
    cv2.rectangle(capa, (x1 + r, y1), (x2 - r, y2), color, -1)
    cv2.rectangle(capa, (x1, y1 + r), (x2, y2 - r), color, -1)
    for cx, cy in ((x1 + r, y1 + r), (x2 - r, y1 + r), (x1 + r, y2 - r), (x2 - r, y2 - r)):
        cv2.circle(capa, (cx, cy), r, color, -1, cv2.LINE_AA)
    mezclar(img, capa, alfa)


def dibujar_tacho(img, cx: int, base: int, alto: int, hex_: str, texto_hex: str,
                  abertura: float = 0.0) -> None:
    """Silueta de tacho (tapa con asa, cuerpo con nervaduras y ruedas), en las
    mismas proporciones que el SVG de la app: viewBox de 100 x 130."""
    s = alto / 130
    x0, y0 = cx - 50 * s, base - 130 * s
    P = lambda x, y: (int(round(x0 + x * s)), int(round(y0 + y * s)))  # noqa: E731

    color = hex_a_bgr(hex_)
    detalle = hex_a_bgr(texto_hex)
    visible = tono_visible(color)
    contorno = (235, 235, 235) if visible != color else (90, 90, 90)
    g = max(1, int(round(1.2 * s)))

    # Halo en el suelo.
    capa = img.copy()
    cv2.ellipse(capa, P(50, 126), (int(40 * s), max(1, int(4 * s))), 0, 0, 360, visible, -1, cv2.LINE_AA)
    mezclar(img, capa, 0.4)

    cuerpo = np.array([P(13, 34), P(87, 34), P(81, 116), P(79, 120), P(74, 122),
                       P(26, 122), P(21, 120), P(19, 116)], np.int32)
    cv2.fillPoly(img, [cuerpo], color, cv2.LINE_AA)
    # Sombra en el lado derecho y borde superior, para dar volumen.
    capa = img.copy()
    cv2.fillPoly(capa, [np.array([P(62, 34), P(87, 34), P(81, 116), P(79, 120),
                                  P(74, 122), P(58, 122)], np.int32)], (0, 0, 0), cv2.LINE_AA)
    cv2.rectangle(capa, P(13, 34), P(87, 40), (0, 0, 0), -1)
    mezclar(img, capa, 0.22)
    cv2.polylines(img, [cuerpo], True, contorno, g, cv2.LINE_AA)

    nervio = tuple(int(c * 0.7 + d * 0.3) for c, d in zip(color, detalle))
    for xa, xb in ((34, 36.5), (50, 50), (66, 63.5)):
        cv2.line(img, P(xa, 50), P(xb, 108), nervio, max(1, int(3.5 * s)), cv2.LINE_AA)
    for xr in (28, 72):
        cv2.circle(img, P(xr, 123), max(2, int(4 * s)), (18, 13, 11), -1, cv2.LINE_AA)
        cv2.circle(img, P(xr, 123), max(2, int(4 * s)), contorno, max(1, g // 2), cv2.LINE_AA)

    # Tapa: gira sobre la bisagra izquierda.
    ang = math.radians(34 * max(0.0, min(1.0, abertura)))
    hx, hy = 10, 32

    def R(x, y):
        dx, dy = x - hx, y - hy
        return P(hx + dx * math.cos(ang) + dy * math.sin(ang),
                 hy - dx * math.sin(ang) + dy * math.cos(ang))

    asa = np.array([R(38, 22), R(38, 14), R(41, 10), R(45, 9), R(55, 9),
                    R(59, 10), R(62, 14), R(62, 22)], np.int32)
    cv2.polylines(img, [asa], False, color, max(2, int(5 * s)), cv2.LINE_AA)
    tapa = np.array([R(8, 19), R(92, 19), R(92, 32), R(8, 32)], np.int32)
    cv2.fillPoly(img, [tapa], color, cv2.LINE_AA)
    capa = img.copy()
    cv2.fillPoly(capa, [np.array([R(8, 19), R(92, 19), R(92, 24), R(8, 24)], np.int32)],
                 (255, 255, 255), cv2.LINE_AA)
    mezclar(img, capa, 0.18)
    cv2.polylines(img, [tapa], True, contorno, g, cv2.LINE_AA)


def anillo(img, centro, radio, valor, color, grosor=5):
    cv2.circle(img, centro, radio, (90, 90, 90), grosor, cv2.LINE_AA)
    if valor > 0:
        cv2.ellipse(img, centro, (radio, radio), -90, 0, 360 * min(1.0, valor), color,
                    grosor, cv2.LINE_AA)


def esquinas(img, cx, cy, lado, color, grosor=4):
    """Visor de escaner: cuatro esquinas, como en la app."""
    m = lado // 2
    brazo = max(12, lado // 7)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        x, y = cx + sx * m, cy + sy * m
        cv2.line(img, (x, y), (x - sx * brazo, y), color, grosor, cv2.LINE_AA)
        cv2.line(img, (x, y), (x, y - sy * brazo), color, grosor, cv2.LINE_AA)


def pantalla_vivo(cuadro, lectura: dict | None, fps: float, ms: float) -> np.ndarray:
    img = cuadro.copy()
    alto, ancho = img.shape[:2]
    k = alto / 720

    if lectura:
        color = hex_a_bgr(lectura["contenedor"]["hex"])
        tono = tono_visible(color)
    else:
        color, tono = (70, 65, 58), NEON
    estab = lectura["estabilidad"] if lectura else 0.0
    progreso = (estab * min(1.0, lectura["confianza"] / CONFIANZA_FIRME)) if lectura else 0.0

    panel_alto = int(170 * k)
    lado = int(min(alto - panel_alto - 80 * k, ancho) * 0.7)
    esquinas(img, ancho // 2, (alto - panel_alto) // 2 + int(20 * k), lado, tono, max(2, int(5 * k)))

    # Medidor superior.
    caja(img, (int(16 * k), int(16 * k)), (int(300 * k), int(58 * k)), FONDO, 0.65, int(20 * k))
    cv2.circle(img, (int(38 * k), int(37 * k)), max(3, int(6 * k)), NEON, -1, cv2.LINE_AA)
    texto(img, f"{fps:4.1f} fps   {ms:4.0f} ms", (int(54 * k), int(46 * k)), 0.7 * k, TEXTO, 1)

    # Panel inferior.
    capa = img.copy()
    cv2.rectangle(capa, (0, alto - panel_alto), (ancho, alto), FONDO, -1)
    mezclar(img, capa, 0.78)
    cv2.line(img, (0, alto - panel_alto), (ancho, alto - panel_alto), tono, max(1, int(2 * k)), cv2.LINE_AA)

    base = alto - int(22 * k)
    hex_ = lectura["contenedor"]["hex"] if lectura else "#3A414D"
    texto_hex = lectura["contenedor"]["texto_hex"] if lectura else "#FFFFFF"
    dibujar_tacho(img, int(80 * k), base, int(125 * k), hex_, texto_hex, 1.0 if progreso >= 1 else 0.0)

    x = int(160 * k)
    if lectura:
        texto(img, lectura["etiqueta"], (x, alto - int(105 * k)), 1.25 * k, tono, max(2, int(3 * k)))
        texto(img, f"Tacho {lectura['contenedor']['nombre']} - {lectura['contenedor']['residuos']}",
              (x, alto - int(68 * k)), 0.7 * k, TEXTO, 1)
        texto(img, "Se captura sola cuando el anillo se llena",
              (x, alto - int(34 * k)), 0.6 * k, TEXTO_SUAVE, 1)
    else:
        texto(img, "Apunta a un residuo", (x, alto - int(95 * k)), 1.1 * k, TEXTO, 2)
        texto(img, "ESPACIO: capturar ya   Q: salir", (x, alto - int(50 * k)), 0.65 * k, TEXTO_SUAVE, 1)

    centro = (ancho - int(85 * k), alto - panel_alto // 2)
    anillo(img, centro, int(52 * k), progreso, tono, max(3, int(7 * k)))
    pct = f"{lectura['confianza']:.0%}" if lectura else "--"
    w = ancho_texto(pct, 0.9 * k, 2)
    texto(img, pct, (centro[0] - w // 2, centro[1] + int(11 * k)), 0.9 * k, TEXTO, 2)
    return img


def pantalla_resultado(foto, r: dict, t: float, total: float) -> np.ndarray:
    """Resultado: foto congelada y oscurecida, tacho del color NTP con la tapa
    que se abre y se cierra, y el veredicto al lado."""
    img = foto.copy()
    alto, ancho = img.shape[:2]
    k = alto / 720
    color = hex_a_bgr(r["contenedor"]["hex"])
    tono = tono_visible(color)

    oscuro = np.full_like(img, FONDO)
    mezclar(img, oscuro, 0.72)
    tinte = np.full_like(img, color)
    mezclar(img, tinte, 0.10)

    # El tacho cae, abre la tapa al entrar y la cierra pasado el primer segundo.
    abertura = min(1.0, t / 0.35) if t < 1.1 else max(0.0, 1 - (t - 1.1) / 0.3)
    caida = min(1.0, t / 0.35)
    alto_tacho = int(alto * 0.52)
    base = int(alto * 0.80 - (1 - caida) ** 2 * alto * 0.3)
    dibujar_tacho(img, int(ancho * 0.25), base, alto_tacho, r["contenedor"]["hex"],
                  r["contenedor"]["texto_hex"], abertura)

    x = int(ancho * 0.47)
    y = int(alto * 0.20)
    texto(img, "VA AL TACHO", (x, y), 0.75 * k, TEXTO_SUAVE, 1)
    texto(img, r["contenedor"]["nombre"].upper(), (x, y + int(70 * k)), 2.3 * k, tono, max(3, int(6 * k)))
    texto(img, r["contenedor"]["residuos"], (x, y + int(115 * k)), 0.85 * k, TEXTO, 2)

    texto(img, r["etiqueta"], (x, y + int(185 * k)), 1.2 * k, TEXTO, max(2, int(3 * k)))
    pct = f"{r['confianza']:.0%}"
    texto(img, pct, (x, y + int(265 * k)), 2.4 * k, tono, max(3, int(6 * k)))
    if r["incierto"]:
        texto(img, "Dudoso: acerca el objeto, con buena luz",
              (x + ancho_texto(pct, 2.4 * k, 6) + int(20 * k), y + int(250 * k)), 0.62 * k, AVISO, 2)

    yy = y + int(310 * k)
    for linea in partir(r["consejo"], ancho - x - int(40 * k), 0.62 * k)[:3]:
        texto(img, linea, (x, yy), 0.62 * k, TEXTO_SUAVE, 1)
        yy += int(30 * k)

    otras = ", ".join(f"{c['etiqueta']} {c['probabilidad']:.0%}" for c in r["top"][1:])
    if otras:
        texto(img, f"Otras: {otras}", (x, yy + int(10 * k)), 0.58 * k, TEXTO_SUAVE, 1)

    # Barra de tiempo restante.
    restante = max(0.0, 1 - t / total)
    cv2.rectangle(img, (0, alto - int(8 * k)), (int(ancho * restante), alto), tono, -1)
    texto(img, "ESPACIO: seguir escaneando", (int(24 * k), alto - int(26 * k)), 0.6 * k, TEXTO_SUAVE, 1)
    return img


# --- Camara y bucle ---------------------------------------------------------

def abrir_camara(fuente: str, ancho: int, alto: int) -> cv2.VideoCapture:
    es_indice = fuente.isdigit()
    candidatas: list[int | str] = [int(fuente)] if es_indice else [fuente]
    if es_indice and fuente == "0":
        # Si la 0 no responde (en algunas Pi la ocupa otro dispositivo de
        # video), se prueban las siguientes.
        candidatas += [1, 2, 3]
    for c in candidatas:
        if isinstance(c, int) and platform.system() == "Linux":
            cam = cv2.VideoCapture(c, cv2.CAP_V4L2)
        else:
            cam = cv2.VideoCapture(c)
        if not cam.isOpened():
            cam.release()
            continue
        if isinstance(c, int):
            # MJPG: las webcams USB solo dan 30 fps a 640x480 o mas en este
            # formato; en YUYV muchas se quedan en 10-15.
            cam.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            cam.set(cv2.CAP_PROP_FRAME_WIDTH, ancho)
            cam.set(cv2.CAP_PROP_FRAME_HEIGHT, alto)
            # Buffer corto: sin esto la camara acumula fotogramas y se analiza
            # algo que paso hace un segundo.
            cam.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, _ = cam.read()
        if ok:
            if str(c) != fuente:
                print(f"La camara {fuente} no respondio; usando la {c}.")
            return cam
        cam.release()
    raise SystemExit(f"No se pudo abrir la camara '{fuente}'. Revisa que este conectada "
                     "(ls /dev/video*) y que no la tenga otro programa, o prueba --fuente 1.")


def hay_pantalla() -> bool:
    if platform.system() == "Linux" and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return False
    try:
        cv2.namedWindow("_prueba", cv2.WINDOW_NORMAL)
        cv2.destroyWindow("_prueba")
        return True
    except cv2.error:
        return False


def enter_pulsado() -> bool:
    """ENTER en la consola, sin bloquear (solo Linux/macOS)."""
    if platform.system() == "Windows":
        return False
    import select
    try:
        listo, _, _ = select.select([sys.stdin], [], [], 0)
    except (OSError, ValueError):
        return False
    if listo:
        sys.stdin.readline()
        return True
    return False


class Historial:
    def __init__(self, carpeta: Path, guardar_fotos: bool) -> None:
        self.csv = carpeta / "historial.csv"
        self.fotos = carpeta / "capturas" if guardar_fotos else None
        if self.fotos:
            self.fotos.mkdir(exist_ok=True)

    def agregar(self, r: dict, foto: np.ndarray, modo: str) -> None:
        ahora = datetime.now()
        nuevo = not self.csv.exists()
        try:
            with self.csv.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if nuevo:
                    w.writerow(["fecha", "material", "etiqueta", "contenedor", "residuos",
                                "confianza", "dudoso", "captura"])
                w.writerow([ahora.isoformat(timespec="seconds"), r["material"], r["etiqueta"],
                            r["contenedor"]["nombre"], r["contenedor"]["residuos"],
                            f"{r['confianza']:.4f}", int(r["incierto"]), modo])
            if self.fotos:
                nombre = f"{ahora:%Y%m%d_%H%M%S}_{r['material']}.jpg"
                cv2.imwrite(str(self.fotos / nombre), foto, [cv2.IMWRITE_JPEG_QUALITY, 85])
        except OSError as exc:
            print(f"(no se pudo guardar el historial: {exc})")


def imprimir_resultado(r: dict, modo: str) -> None:
    duda = "   [DUDOSO: acerca el objeto]" if r["incierto"] else ""
    otras = ", ".join(f"{c['etiqueta']} {c['probabilidad']:.0%}" for c in r["top"][1:])
    print("\n" + "=" * 60)
    print(f"  TACHO {r['contenedor']['nombre'].upper()}  ({r['contenedor']['residuos']})")
    print(f"  {r['etiqueta']}  {r['confianza']:.1%}{duda}   [{modo}, {r['ms']:.0f} ms]")
    if r["consejo"]:
        print(f"  {r['consejo']}")
    if otras:
        print(f"  Otras: {otras}")
    print("=" * 60 + "\n")


def main() -> None:
    aqui = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelo", type=Path, default=None,
                    help="ONNX a usar (por defecto modelo.onnx, o modelo_rapido.onnx con --rapido)")
    ap.add_argument("--meta", type=Path, default=aqui / "modelo_meta.json")
    ap.add_argument("--rapido", action="store_true",
                    help="usa el modelo int8: mas fotogramas, ~1,7 puntos menos de exactitud")
    ap.add_argument("--fuente", default="0",
                    help="indice de la camara (0, 1, ...) o ruta de un video")
    ap.add_argument("--ancho", type=int, default=640)
    ap.add_argument("--alto", type=int, default=480)
    ap.add_argument("--hilos", type=int, default=4,
                    help="hilos de ONNX Runtime; 4 = los nucleos de la Pi 4")
    ap.add_argument("--headless", action="store_true",
                    help="sin ventana: imprime por consola (util por SSH)")
    ap.add_argument("--pantalla-completa", action="store_true")
    ap.add_argument("--sin-auto", action="store_true",
                    help="desactiva la captura automatica (solo ESPACIO / ENTER)")
    ap.add_argument("--segundos", type=float, default=SEGUNDOS_RESULTADO,
                    help="cuanto se muestra cada resultado")
    ap.add_argument("--guardar-fotos", action="store_true",
                    help="guarda cada captura en capturas/ ademas del historial.csv")
    args = ap.parse_args()

    modelo = args.modelo or aqui / ("modelo_rapido.onnx" if args.rapido else "modelo.onnx")
    for ruta in (modelo, args.meta):
        if not ruta.exists():
            raise SystemExit(f"Falta {ruta}. Copia el .onnx y su modelo_meta.json aqui.")

    clf = Clasificador(modelo, args.meta, args.hilos)
    print(f"modelo   : {modelo.name} ({modelo.stat().st_size / 1e6:.1f} MB)")
    print(f"entrada  : {clf.recorte}x{clf.recorte} | {len(clf.clases)} materiales -> 7 tachos NTP")
    print(f"hilos    : {args.hilos}")

    headless = args.headless
    if not headless and not hay_pantalla():
        print("No hay pantalla disponible (o OpenCV no tiene soporte de ventanas): "
              "sigo en modo --headless.")
        headless = True

    cam = abrir_camara(args.fuente, args.ancho, args.alto)
    print(f"camara   : {int(cam.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cam.get(cv2.CAP_PROP_FRAME_HEIGHT))}")
    historial = Historial(aqui, args.guardar_fotos)

    ventana = "Reciclaje NTP 900.058"
    if not headless:
        cv2.namedWindow(ventana, cv2.WINDOW_NORMAL)
        if args.pantalla_completa:
            cv2.setWindowProperty(ventana, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
        else:
            cv2.resizeWindow(ventana, 960, 720)
        print("ventana  : ESPACIO captura ya, Q o ESC sale")
    else:
        print("consola  : ENTER captura ya, Ctrl+C sale")
    print("Apunta la camara a un residuo; se captura sola cuando la lectura es firme.\n")

    # Con un archivo de video se respeta su ritmo real: si no, se reproduciria
    # tan rapido como de la CPU y la estabilidad (que se mide en segundos) no
    # se pareceria a la de una camara.
    ritmo = 0.0
    if not args.fuente.isdigit():
        fps_video = cam.get(cv2.CAP_PROP_FPS)
        ritmo = 1 / fps_video if fps_video and fps_video > 0 else 0.0
    siguiente = time.time()

    marcas: list[float] = []
    ultimo_log = 0.0
    disparado_para: str | None = None
    resultado: dict | None = None
    foto_resultado: np.ndarray | None = None
    resultado_desde = 0.0

    try:
        while True:
            ok, cuadro = cam.read()
            if not ok:
                print("Fin de la fuente de video.")
                break
            if ritmo:
                espera = siguiente - time.time()
                if espera > 0:
                    time.sleep(espera)
                siguiente = max(siguiente, time.time()) + ritmo

            # La lectura en vivo sigue corriendo tambien mientras se muestra un
            # resultado: asi se sabe si el usuario aparto el objeto.
            lectura = clf.clasificar(cuadro)
            ahora = time.time()
            marcas = [t for t in marcas + [ahora] if ahora - t < 3.0]
            fps = len(marcas) / 3.0

            if lectura["confianza"] < CONFIANZA_SUELTA:
                disparado_para = None

            if headless:
                tecla_captura, tecla_salir = enter_pulsado(), False
            else:
                tecla = cv2.waitKey(1) & 0xFF
                tecla_captura, tecla_salir = tecla == ord(" "), tecla in (ord("q"), 27)
            if tecla_salir:
                break

            # Cerrar el resultado: por tiempo o con ESPACIO.
            if resultado is not None:
                t = ahora - resultado_desde
                if t >= args.segundos or (tecla_captura and t > 0.5):
                    resultado = None
                    tecla_captura = False

            if resultado is None:
                firme = (lectura["estabilidad"] >= 1
                         and lectura["confianza"] >= CONFIANZA_FIRME)
                auto = (not args.sin_auto and firme
                        and disparado_para != lectura["material"])
                if auto or tecla_captura:
                    modo = "manual" if tecla_captura else "auto"
                    disparado_para = lectura["material"]
                    resultado = clf.analizar(cuadro)
                    foto_resultado = cuadro.copy()
                    resultado_desde = time.time()
                    historial.agregar(resultado, cuadro, modo)
                    imprimir_resultado(resultado, modo)

            if headless:
                if resultado is None and ahora - ultimo_log >= 1.0:
                    barra = "#" * int(lectura["estabilidad"] * 10)
                    print(f"{lectura['contenedor']['nombre'].upper():<9} "
                          f"{lectura['etiqueta']:<18} {lectura['confianza']:5.1%}  "
                          f"[{barra:<10}]  {fps:4.1f} fps  {lectura['ms_inferencia']:5.1f} ms")
                    ultimo_log = ahora
                continue

            if resultado is not None and foto_resultado is not None:
                vista = cv2.resize(foto_resultado, (960, 720), interpolation=cv2.INTER_LINEAR)
                img = pantalla_resultado(vista, resultado, time.time() - resultado_desde, args.segundos)
            else:
                vista = cv2.resize(cuadro, (960, 720), interpolation=cv2.INTER_LINEAR)
                img = pantalla_vivo(vista, lectura, fps, lectura["ms_inferencia"])
            cv2.imshow(ventana, img)
    except KeyboardInterrupt:
        print("\nInterrumpido.")
    finally:
        cam.release()
        if not headless:
            cv2.destroyAllWindows()
        if historial.csv.exists():
            print(f"Historial en {historial.csv}")


if __name__ == "__main__":
    main()
