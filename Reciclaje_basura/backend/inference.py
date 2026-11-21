"""Carga del modelo y clasificacion de una foto.

El servidor consume el modelo TorchScript, no el checkpoint de entrenamiento:
el grafo trae los pesos dentro, asi que no hace falta importar la definicion de
la red y el backend queda independiente del codigo de entrenamiento.
"""

from __future__ import annotations

import io
import json
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image, UnidentifiedImageError

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE / "ml"))
from imaging import (CROP_SIZE, TARGET_SIZE, abrir_reducida,  # noqa: E402
                     to_input_array)

DEFAULT_MODEL = BASE / "artifacts" / "model_scripted.pt"
DEFAULT_META = BASE / "artifacts" / "model_meta.json"

# Por debajo de esta confianza la respuesta se marca como incierta y la app
# pide repetir la foto, en vez de mandar al usuario a un tacho equivocado.
DEFAULT_UMBRAL = 0.55


class ModelNotReady(RuntimeError):
    """El modelo aun no se ha exportado."""


class ImagenInvalida(ValueError):
    """El archivo recibido no es una imagen que se pueda leer."""


@dataclass
class Prediccion:
    material: str
    material_label: str
    color: str
    confianza: float
    incierto: bool
    top: list[dict[str, Any]]
    ms: float


class Clasificador:
    """Envuelve el modelo TorchScript. Seguro de usar desde varios hilos."""

    def __init__(self, model_path: Path = DEFAULT_MODEL, meta_path: Path = DEFAULT_META,
                 device: str | None = None, umbral: float = DEFAULT_UMBRAL) -> None:
        if not model_path.exists() or not meta_path.exists():
            raise ModelNotReady(
                f"Faltan {model_path.name} o {meta_path.name} en {model_path.parent}. "
                "Corre: python ml/train.py && python ml/export_model.py"
            )

        self.meta: dict[str, Any] = json.loads(meta_path.read_text(encoding="utf-8"))
        self.classes: list[str] = self.meta["classes"]
        self.material_to_color: dict[str, str] = self.meta["material_to_color"]
        self.img_size: int = int(self.meta.get("img_size", CROP_SIZE))
        self.umbral = umbral

        # El backend sirve dos formatos: el TorchScript del modelo grande y el
        # ONNX int8 del modelo de Raspberry Pi. Asi la misma app movil puede
        # apuntar a cualquiera de los dos sin tocar el cliente.
        self.formato = "onnx" if model_path.suffix == ".onnx" else "torchscript"

        if self.formato == "onnx":
            import onnxruntime as ort
            opciones = ort.SessionOptions()
            opciones.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self.ses = ort.InferenceSession(str(model_path), opciones,
                                            providers=["CPUExecutionProvider"])
            self.entrada = self.ses.get_inputs()[0].name
            self.device = torch.device("cpu")
        else:
            self.device = torch.device(
                device or ("cuda" if torch.cuda.is_available() else "cpu"))
            self.model = torch.jit.load(str(model_path),
                                        map_location=self.device).eval()
        # torch.jit.load no es reentrante al ejecutar; un lock evita que dos
        # peticiones simultaneas se pisen en el mismo grafo.
        self._lock = threading.Lock()

        self._labels = {
            m["key"]: m["label"] for m in self.meta["taxonomy"]["materiales"]
        }
        self._tips = {
            m["key"]: m["tip"] for m in self.meta["taxonomy"]["materiales"]
        }
        self._calentar()

    def _calentar(self, pasadas: int = 3) -> None:
        """Inferencias en vacio al arrancar, para que la primera foto real no pague
        la seleccion de algoritmos de cuDNN.

        Con una sola pasada la primera peticion de verdad seguia tardando ~2 s;
        con tres baja a los ~25 ms del resto.
        """
        x = np.zeros((1, 3, self.img_size, self.img_size), dtype=np.float32)
        with self._lock:
            for _ in range(pasadas):
                self._logits(x)
                self._logits(x[:, :, :, ::-1].copy())   # la rama de TTA tambien
        if self.formato == "torchscript" and self.device.type == "cuda":
            torch.cuda.synchronize()

    def _logits(self, arr: np.ndarray) -> np.ndarray:
        if self.formato == "onnx":
            return self.ses.run(None, {self.entrada: arr})[0]
        with torch.no_grad():
            t = torch.from_numpy(arr).to(self.device)
            return self.model(t).float().cpu().numpy()

    @property
    def info(self) -> dict[str, Any]:
        return {
            "arch": self.meta.get("arch"),
            "clases": self.classes,
            "img_size": self.img_size,
            "fit_size": TARGET_SIZE,
            "device": str(self.device),
            "formato": self.formato,
            "umbral_confianza": self.umbral,
            "epoca_entrenamiento": self.meta.get("trained_epoch"),
            "metricas_validacion": self.meta.get("val_metrics", {}),
        }

    def abrir(self, raw: bytes) -> Image.Image:
        try:
            # Decodifica ya reducida: con los fotogramas de la vista en vivo
            # descomprimir el JPEG entero costaba mas que la propia red.
            return abrir_reducida(io.BytesIO(raw))
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise ImagenInvalida(f"No se pudo leer la imagen: {exc}") from exc

    def predecir(self, raw: bytes, tta: bool = False, topk: int = 3) -> Prediccion:
        t0 = time.perf_counter()
        img = self.abrir(raw)
        arr = to_input_array(img, crop=self.img_size)

        with self._lock:
            logits = self._logits(arr)
            if tta:
                logits = (logits + self._logits(arr[:, :, :, ::-1].copy())) / 2
        e = np.exp(logits[0] - logits[0].max())
        probs = e / e.sum()

        orden = np.argsort(probs)[::-1][:max(1, min(topk, len(self.classes)))]
        top = [
            {
                "material": self.classes[i],
                "label": self._labels.get(self.classes[i], self.classes[i]),
                "color": self.material_to_color[self.classes[i]],
                "probabilidad": round(float(probs[i]), 4),
            }
            for i in orden
        ]
        mejor = self.classes[int(orden[0])]
        conf = float(probs[int(orden[0])])
        return Prediccion(
            material=mejor,
            material_label=self._labels.get(mejor, mejor),
            color=self.material_to_color[mejor],
            confianza=round(conf, 4),
            incierto=conf < self.umbral,
            top=top,
            ms=round((time.perf_counter() - t0) * 1000, 1),
        )

    def tip(self, material: str) -> str:
        return self._tips.get(material, "")
