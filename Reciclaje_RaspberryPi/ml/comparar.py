"""Compara los candidatos exportados y elige el que va a la Raspberry Pi.

Mide, para cada ONNX de la carpeta de artefactos:
  * exactitud sobre el conjunto de test, a nivel material y a nivel color de
    contenedor (lo segundo es lo que de verdad ve el usuario);
  * tamano en disco;
  * latencia por imagen en CPU.

Sobre la latencia: aqui se mide en el x86 de desarrollo limitando ONNX Runtime
a 4 hilos, que es el numero de nucleos de la Pi 4. No es la cifra de la Pi
--un Cortex-A72 a 1,5 GHz rinde bastante menos por nucleo que un x86
moderno-- pero sirve para ordenar los candidatos entre si, que es para lo que
se usa. La cifra real se obtiene con rpi/bench.py en la propia Pi.

Uso:
    python ml/comparar.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from torch.utils.data import DataLoader
from torchvision import datasets

sys.path.insert(0, str(Path(__file__).resolve().parent))
from destilar import build_transforms
from taxonomy import COLOR_ORDER, MATERIAL_CLASSES, MATERIAL_TO_COLOR

HILOS = 4            # los nucleos de una Raspberry Pi 4
REPETICIONES = 60    # medidas de latencia tras el calentamiento


def sesion(ruta: Path) -> ort.InferenceSession:
    opciones = ort.SessionOptions()
    opciones.intra_op_num_threads = HILOS
    opciones.inter_op_num_threads = 1
    opciones.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(ruta), opciones,
                                providers=["CPUExecutionProvider"])


def macro_f1(cm: np.ndarray) -> float:
    f1 = []
    for i in range(cm.shape[0]):
        tp = cm[i, i]
        denom = 2 * tp + (cm[:, i].sum() - tp) + (cm[i, :].sum() - tp)
        f1.append(0.0 if denom == 0 else 2 * tp / denom)
    return float(np.mean(f1))


def evaluar(ses: ort.InferenceSession, loader: DataLoader) -> dict:
    entrada = ses.get_inputs()[0].name
    n = len(MATERIAL_CLASSES)
    cm = np.zeros((n, n), dtype=np.int64)
    color_de = np.array([COLOR_ORDER.index(MATERIAL_TO_COLOR[m])
                         for m in MATERIAL_CLASSES])

    for x, y in loader:
        lote = x.numpy().astype(np.float32)
        for i in range(lote.shape[0]):
            pred = int(ses.run(None, {entrada: lote[i:i + 1]})[0].argmax())
            cm[int(y[i]), pred] += 1

    aciertos_color = sum(
        cm[i, j] for i in range(n) for j in range(n) if color_de[i] == color_de[j])
    return {"acc": float(np.trace(cm) / cm.sum()),
            "macro_f1": macro_f1(cm),
            "color_acc": float(aciertos_color / cm.sum())}


def medir_latencia(ses: ort.InferenceSession, tam: int) -> dict:
    entrada = ses.get_inputs()[0].name
    x = np.random.rand(1, 3, tam, tam).astype(np.float32)
    for _ in range(10):
        ses.run(None, {entrada: x})
    tiempos = []
    for _ in range(REPETICIONES):
        t = time.perf_counter()
        ses.run(None, {entrada: x})
        tiempos.append((time.perf_counter() - t) * 1000)
    tiempos.sort()
    return {"mediana_ms": tiempos[len(tiempos) // 2],
            "p90_ms": tiempos[int(len(tiempos) * 0.9)]}


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    principal = base.parent / "Reciclaje_basura"
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--art-dir", type=Path, default=base / "artifacts")
    ap.add_argument("--data-dir", type=Path,
                    default=principal / "data" / "processed" / "ntp")
    ap.add_argument("--split", default="test")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    modelos = sorted(args.art_dir.glob("*.onnx"))
    if not modelos:
        raise SystemExit(f"No hay modelos ONNX en {args.art_dir}. Corre ml/exportar.py")

    filas = []
    cache_loader: dict[int, DataLoader] = {}

    for ruta in modelos:
        meta_path = args.art_dir / (
            ruta.stem.replace("_int8", "").replace("_fp32", "") + "_meta.json")
        if not meta_path.exists():
            print(f"  aviso: sin metadatos para {ruta.name}, se omite")
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        tam = meta["img_size"]

        if tam not in cache_loader:
            _, eval_tf = build_transforms(tam)
            ds = datasets.ImageFolder(args.data_dir / args.split, transform=eval_tf)
            if ds.classes != MATERIAL_CLASSES:
                raise SystemExit(f"Clases inesperadas en {args.data_dir / args.split}")
            cache_loader[tam] = DataLoader(ds, batch_size=32, shuffle=False,
                                           num_workers=args.workers)

        print(f"evaluando {ruta.name} ...", flush=True)
        ses = sesion(ruta)
        metricas = evaluar(ses, cache_loader[tam])
        latencia = medir_latencia(ses, tam)
        filas.append({
            "modelo": ruta.stem,
            "arch": meta["arch"],
            "precision": "int8" if ruta.stem.endswith("_int8") else "fp32",
            "img_size": tam,
            "mb": round(ruta.stat().st_size / 1e6, 1),
            "parametros": meta.get("parametros"),
            **metricas, **latencia,
        })

    filas.sort(key=lambda f: (-f["color_acc"], f["mediana_ms"]))

    print("\n" + "=" * 100)
    print(f"CANDIDATOS PARA RASPBERRY PI 4 -- split {args.split} "
          f"({len(cache_loader[filas[0]['img_size']].dataset)} imagenes)")
    print("=" * 100)
    cab = (f"{'modelo':<34}{'prec':>6}{'MB':>7}{'material':>10}"
           f"{'macroF1':>9}{'color':>8}{'ms(x86)':>10}")
    print(cab)
    print("-" * 100)
    for f in filas:
        print(f"{f['modelo']:<34}{f['precision']:>6}{f['mb']:>7.1f}"
              f"{f['acc']:>10.4f}{f['macro_f1']:>9.4f}{f['color_acc']:>8.4f}"
              f"{f['mediana_ms']:>10.1f}")
    print("-" * 100)

    ganador = filas[0]
    print(f"\nMejor por exactitud de contenedor: {ganador['modelo']} "
          f"({ganador['color_acc']:.4f}, {ganador['mb']} MB, "
          f"{ganador['mediana_ms']:.1f} ms en x86 con {HILOS} hilos)")
    print("La latencia real de la Pi se mide con rpi/bench.py; "
          "espera entre 4 y 8 veces estos milisegundos.")

    salida = args.art_dir / f"comparativa_{args.split}.json"
    salida.write_text(json.dumps(
        {"hilos": HILOS, "split": args.split, "candidatos": filas},
        indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDetalle: {salida}")


if __name__ == "__main__":
    main()
