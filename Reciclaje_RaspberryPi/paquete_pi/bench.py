#!/usr/bin/env python3
"""Mide la latencia real del modelo en esta maquina (pensado para la Pi).

Separa preprocesamiento de inferencia porque en una Pi el redimensionado no es
despreciable: si el preproceso cuesta mas que la red, el arreglo no es cambiar
de modelo sino bajar la resolucion de captura.

Uso:
    python3 bench.py
    python3 bench.py --hilos 2 --repeticiones 100
"""

from __future__ import annotations

import argparse
import json
import platform
import time
from pathlib import Path

import numpy as np

from detectar import Clasificador


def main() -> None:
    aqui = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--modelo", type=Path, default=aqui / "modelo.onnx")
    ap.add_argument("--meta", type=Path, default=aqui / "modelo_meta.json")
    ap.add_argument("--hilos", type=int, default=4)
    ap.add_argument("--repeticiones", type=int, default=60)
    ap.add_argument("--ancho", type=int, default=640)
    ap.add_argument("--alto", type=int, default=480)
    args = ap.parse_args()

    for ruta in (args.modelo, args.meta):
        if not ruta.exists():
            raise SystemExit(f"Falta {ruta}")

    print(f"maquina : {platform.machine()} | {platform.system()}")
    print(f"modelo  : {args.modelo.name} ({args.modelo.stat().st_size/1e6:.1f} MB)")
    print(f"hilos   : {args.hilos}")

    clf = Clasificador(args.modelo, args.meta, args.hilos)
    # Fotograma sintetico del tamano que entrega una camara web tipica.
    cuadro = (np.random.rand(args.alto, args.ancho, 3) * 255).astype(np.uint8)

    for _ in range(10):
        clf.clasificar(cuadro)

    prep, inf, total = [], [], []
    for _ in range(args.repeticiones):
        t = time.perf_counter()
        r = clf.clasificar(cuadro)
        total.append((time.perf_counter() - t) * 1000)
        prep.append(r["ms_prep"])
        inf.append(r["ms_inferencia"])

    def resumen(nombre: str, v: list[float]) -> dict:
        s = sorted(v)
        d = {"mediana": s[len(s) // 2], "p90": s[int(len(s) * 0.9)],
             "min": s[0], "max": s[-1]}
        print(f"  {nombre:<16} mediana {d['mediana']:6.1f} ms   "
              f"p90 {d['p90']:6.1f} ms   min {d['min']:6.1f}   max {d['max']:6.1f}")
        return d

    print(f"\n{args.repeticiones} repeticiones sobre {args.ancho}x{args.alto}:")
    d_prep = resumen("preproceso", prep)
    d_inf = resumen("inferencia", inf)
    d_tot = resumen("total", total)
    print(f"\n  ritmo sostenible: {1000/d_tot['mediana']:.1f} fotogramas/s")

    salida = aqui / "bench.json"
    salida.write_text(json.dumps({
        "maquina": platform.machine(), "hilos": args.hilos,
        "modelo": args.modelo.name, "resolucion": [args.ancho, args.alto],
        "preproceso_ms": d_prep, "inferencia_ms": d_inf, "total_ms": d_tot,
        "fps": round(1000 / d_tot["mediana"], 2),
    }, indent=2), encoding="utf-8")
    print(f"\nGuardado en {salida}")


if __name__ == "__main__":
    main()
