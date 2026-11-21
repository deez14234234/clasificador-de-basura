"""Deja listo el paquete que se copia a la Raspberry Pi.

Deja en `paquete_pi/` solo lo que hace falta en el dispositivo:

  modelo.onnx         principal, fp32: la misma exactitud que el .pt
  modelo_rapido.onnx  int8, para cuando haga falta mas fotogramas
  modelo_meta.json    clases, colores NTP y consejos
  detectar.py, bench.py, instalar.sh, iniciar.sh, requirements.txt, LEEME.md

Nada de codigo de entrenamiento ni del dataset.

Por que el principal es fp32: medido sobre las 1226 imagenes de test, el fp32
da 96,66 % de material y el int8 95,02 % (ver ml/exportar.py). En la Pi 4 el
fp32 sigue siendo de sobra para la camara en vivo, asi que se prioriza la
exactitud y el int8 queda como opcion con --rapido.

Uso:
    python ml/preparar_pi.py --auto
    python ml/preparar_pi.py --modelo artifacts/efficientnet_lite0_224_fp32.onnx \
                             --rapido artifacts/efficientnet_lite0_224_int8.onnx
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ARCHIVOS_PI = ("detectar.py", "bench.py", "instalar.sh", "iniciar.sh",
               "requirements.txt", "LEEME.md")


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelo", type=Path, help="ONNX principal")
    ap.add_argument("--rapido", type=Path, help="ONNX int8 opcional")
    ap.add_argument("--auto", action="store_true",
                    help="efficientnet_lite0: fp32 como principal e int8 como rapido")
    ap.add_argument("--art-dir", type=Path, default=base / "artifacts")
    ap.add_argument("--destino", type=Path, default=base / "paquete_pi")
    args = ap.parse_args()

    if args.auto:
        principal = args.art_dir / "efficientnet_lite0_224_fp32.onnx"
        rapido = args.art_dir / "efficientnet_lite0_224_int8.onnx"
    elif args.modelo:
        principal, rapido = args.modelo, args.rapido
    else:
        raise SystemExit("Pasa --auto, o --modelo <ruta.onnx> [--rapido <ruta.onnx>]")

    if not principal.exists():
        raise SystemExit(f"No existe {principal}. Genera los ONNX con ml/exportar.py.")

    raiz = principal.stem.replace("_int8", "").replace("_fp32", "")
    meta = args.art_dir / f"{raiz}_meta.json"
    if not meta.exists():
        raise SystemExit(f"Falta {meta}")

    args.destino.mkdir(parents=True, exist_ok=True)
    shutil.copy2(principal, args.destino / "modelo.onnx")
    if rapido and rapido.exists():
        shutil.copy2(rapido, args.destino / "modelo_rapido.onnx")
    else:
        (args.destino / "modelo_rapido.onnx").unlink(missing_ok=True)
    shutil.copy2(meta, args.destino / "modelo_meta.json")
    for f in ARCHIVOS_PI:
        # newline="\n": los .sh tienen que llegar a la Pi con finales de linea
        # de Unix aunque el paquete se arme en Windows.
        texto = (base / "rpi" / f).read_text(encoding="utf-8")
        (args.destino / f).write_text(texto, encoding="utf-8", newline="\n")

    datos = json.loads(meta.read_text(encoding="utf-8"))
    mb = lambda p: p.stat().st_size / 1e6                       # noqa: E731
    total = sum(f.stat().st_size for f in args.destino.iterdir() if f.is_file()) / 1e6

    print(f"Paquete listo en {args.destino}")
    print(f"  principal: {principal.name}  ({mb(args.destino / 'modelo.onnx'):.1f} MB)")
    if (args.destino / "modelo_rapido.onnx").exists():
        print(f"  rapido   : {rapido.name}  ({mb(args.destino / 'modelo_rapido.onnx'):.1f} MB)")
    print(f"  entrada  : {datos['img_size']}x{datos['img_size']}")
    print(f"  clases   : {len(datos['classes'])} materiales -> 7 contenedores")
    print(f"  total    : {total:.1f} MB\n")
    print("Copialo a la Pi y arranca (ver LEEME.md):")
    print(f"  scp -r \"{args.destino}\" pi@raspberrypi.local:~/reciclaje")
    print("  ssh pi@raspberrypi.local")
    print("  cd ~/reciclaje && bash instalar.sh")
    print("  bash iniciar.sh")


if __name__ == "__main__":
    main()
