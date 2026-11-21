"""Exporta un alumno destilado a ONNX y lo cuantiza a int8 para la Raspberry Pi.

Por que int8 y no float32: la Pi 4 no tiene acelerador de redes utilizable, asi
que todo corre en el Cortex-A72. La cuantizacion a enteros de 8 bits reduce el
modelo a una cuarta parte y, sobre todo, deja que ONNX Runtime use las
instrucciones NEON de enteros, que en ARM son bastante mas rapidas que las de
coma flotante. Tipicamente es 2-3x mas rapido con una perdida de exactitud de
decimas.

Se usa cuantizacion **estatica**: se calibra con imagenes reales para fijar los
rangos de las activaciones. La dinamica es mas comoda pero en redes
convolucionales apenas acelera, porque recalcula los rangos en cada inferencia.

Medido despues (test, 1226 imagenes): cuantizar el grafo entero le cuesta a
efficientnet_lite0 cuatro puntos (96,66 % fp32 -> 92,58 % int8), y cambiar el
metodo de calibracion (Percentile, Entropy) no lo arregla. Lo que si lo
arregla es dejar en fp32 la primera convolucion y el clasificador final, que
son las capas mas sensibles al redondeo: 95,02 % con el mismo tamano. Por eso
se excluyen por defecto. El fp32 se conserva siempre: es el modelo principal
del paquete y el int8 queda como opcion rapida.

Uso:
    python ml/exportar.py --checkpoint artifacts/mobilenetv4_conv_small_224.pt
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import timm
import torch
from onnxruntime.quantization import (CalibrationDataReader, QuantFormat,
                                      QuantType, quantize_static)
from onnxruntime.quantization.shape_inference import quant_pre_process
from torch.utils.data import DataLoader
from torchvision import datasets

sys.path.insert(0, str(Path(__file__).resolve().parent))
from destilar import build_transforms
from taxonomy import MATERIAL_LABEL, MATERIAL_TIP, MATERIAL_TO_COLOR, taxonomy_payload

# Imagenes de calibracion. Con muchas menos los rangos salen ruidosos; con
# muchas mas no mejora y la cuantizacion tarda varios minutos.
N_CALIBRACION = 320


class LectorCalibracion(CalibrationDataReader):
    """Alimenta al cuantizador con imagenes reales del conjunto de entrenamiento.

    Tienen que pasar por el mismo preprocesamiento que en inferencia: si se
    calibrara con imagenes sin normalizar, los rangos aprendidos no se
    parecerian a los que vera la Pi y la exactitud se desplomaria.
    """

    def __init__(self, data_dir: Path, img_size: int, nombre_entrada: str,
                 n: int = N_CALIBRACION) -> None:
        _, eval_tf = build_transforms(img_size)
        ds = datasets.ImageFolder(data_dir / "train", transform=eval_tf)
        # Muestreo disperso y determinista: recorrer las primeras N daria solo
        # la primera clase, y la calibracion necesita ver todos los materiales.
        paso = max(1, len(ds) // n)
        indices = list(range(0, len(ds), paso))[:n]
        self._nombre = nombre_entrada
        self._lote = iter([
            {nombre_entrada: ds[i][0].unsqueeze(0).numpy().astype(np.float32)}
            for i in indices
        ])
        self.total = len(indices)

    def get_next(self):
        return next(self._lote, None)


def cargar_alumno(ckpt_path: Path):
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    modelo = timm.create_model(ckpt["arch"], pretrained=False,
                               num_classes=len(ckpt["classes"]))
    modelo.load_state_dict(ckpt["state_dict"])
    modelo.eval()
    return modelo, ckpt


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    principal = base.parent / "Reciclaje_basura"
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--data-dir", type=Path,
                    default=principal / "data" / "processed" / "ntp")
    ap.add_argument("--out-dir", type=Path, default=base / "artifacts")
    ap.add_argument("--opset", type=int, default=18)
    ap.add_argument("--sin-int8", action="store_true", help="exporta solo fp32")
    ap.add_argument("--conservar-fp32", action="store_true",
                    help="(obsoleto: el fp32 se conserva siempre)")
    args = ap.parse_args()

    if not args.checkpoint.exists():
        raise SystemExit(f"No existe {args.checkpoint}")

    modelo, ckpt = cargar_alumno(args.checkpoint)
    tam = ckpt["img_size"]
    nombre = f"{ckpt['arch']}_{tam}"
    args.out_dir.mkdir(parents=True, exist_ok=True)

    ruta_fp32 = args.out_dir / f"{nombre}_fp32.onnx"
    ruta_prep = args.out_dir / f"{nombre}_prep.onnx"
    ruta_int8 = args.out_dir / f"{nombre}_int8.onnx"

    # Lote fijo de 1: en la Pi siempre se procesa un fotograma cada vez, y un
    # eje fijo deja que ONNX Runtime optimice mas el grafo.
    ejemplo = torch.randn(1, 3, tam, tam)
    print(f"[1/4] ONNX fp32 -> {ruta_fp32.name}")
    torch.onnx.export(modelo, ejemplo, str(ruta_fp32),
                      input_names=["input"], output_names=["logits"],
                      opset_version=args.opset, dynamo=False)

    import onnxruntime as ort
    sesion = ort.InferenceSession(str(ruta_fp32), providers=["CPUExecutionProvider"])
    entrada = sesion.get_inputs()[0].name
    with torch.no_grad():
        esperado = modelo(ejemplo).numpy()
    obtenido = sesion.run(None, {entrada: ejemplo.numpy()})[0]
    delta = float(np.abs(esperado - obtenido).max())
    print(f"      diferencia maxima frente a PyTorch: {delta:.2e}")
    if delta > 1e-3:
        raise SystemExit("El ONNX fp32 no coincide con el modelo original.")

    meta = {
        "arch": ckpt["arch"],
        "classes": ckpt["classes"],
        "img_size": tam,
        "normalization": ckpt["normalization"],
        "material_to_color": MATERIAL_TO_COLOR,
        "material_label": MATERIAL_LABEL,
        "material_tip": MATERIAL_TIP,
        "taxonomy": taxonomy_payload(),
        "val_metrics": ckpt.get("val_metrics", {}),
        "parametros": ckpt.get("info", {}).get("parametros"),
    }
    ruta_meta = args.out_dir / f"{nombre}_meta.json"
    ruta_meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False),
                         encoding="utf-8")
    print(f"      metadatos -> {ruta_meta.name}")

    if args.sin_int8:
        return

    # quant_pre_process infiere formas y simplifica el grafo. Sin este paso la
    # cuantizacion deja muchos nodos fuera y la ganancia se evapora.
    print("[2/4] preparando el grafo para cuantizar")
    quant_pre_process(str(ruta_fp32), str(ruta_prep), skip_symbolic_shape=True)

    print(f"[3/4] calibrando con {N_CALIBRACION} imagenes reales")
    lector = LectorCalibracion(args.data_dir, tam, entrada)

    print("[4/4] cuantizando a int8")
    # Primera convolucion y capa final en fp32: ver la nota del principio.
    import onnx
    nodos = onnx.load(str(ruta_prep)).graph.node
    excluir = [n.name for n in nodos if n.op_type == "Conv"][:1]
    excluir += [n.name for n in nodos if n.op_type in ("Gemm", "MatMul")][-1:]
    print(f"      en fp32: {', '.join(excluir)}")

    quantize_static(
        str(ruta_prep), str(ruta_int8), lector,
        nodes_to_exclude=excluir,
        quant_format=QuantFormat.QDQ,
        # Pesos con signo y por canal (mas preciso en convoluciones),
        # activaciones sin signo: es la combinacion mejor soportada por los
        # nucleos de ARM en ONNX Runtime.
        per_channel=True,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
    )
    ruta_prep.unlink(missing_ok=True)

    mb = lambda p: p.stat().st_size / 1e6                       # noqa: E731
    mb_fp32, mb_int8 = mb(ruta_fp32), mb(ruta_int8)
    print(f"\n  fp32: {ruta_fp32.name:38s} {mb_fp32:6.1f} MB")
    print(f"  int8: {ruta_int8.name:38s} {mb_int8:6.1f} MB "
          f"({mb_fp32/mb_int8:.1f}x mas pequeno)")

    # El fp32 se conserva: es el modelo principal del paquete de la Pi.
    print("\nSiguiente paso: python ml/preparar_pi.py --auto")


if __name__ == "__main__":
    main()
