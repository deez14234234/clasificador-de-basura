#!/usr/bin/env bash
# Instala lo necesario en una Raspberry Pi 4 con Raspberry Pi OS de 64 bits.
#
#   bash instalar.sh
#
# Por que asi y no con "pip3 install" directo: desde Raspberry Pi OS Bookworm,
# pip no deja instalar paquetes en el Python del sistema (PEP 668). Se usa un
# entorno virtual que ve el OpenCV y el numpy de apt (el OpenCV de apt trae
# soporte de ventanas y esta compilado para la Pi) y solo se instala
# onnxruntime con pip.
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname -m)" != "aarch64" ]; then
  echo "Este sistema es $(uname -m). Hace falta Raspberry Pi OS de 64 bits (aarch64):" >&2
  echo "onnxruntime no publica paquetes para 32 bits." >&2
  exit 1
fi

echo "[1/3] Paquetes del sistema: OpenCV, numpy y utilidades de camara"
sudo apt-get update
sudo apt-get install -y python3-venv python3-opencv python3-numpy v4l-utils

echo "[2/3] Entorno virtual en .venv"
python3 -m venv --system-site-packages .venv
NUMPY=$(.venv/bin/python -c 'import numpy; print(numpy.__version__)')
.venv/bin/pip install --upgrade pip
# Se fija la numpy del sistema: si pip trajera otra version, el OpenCV de apt
# (compilado contra esa numpy) dejaria de importar.
.venv/bin/pip install -r requirements.txt "numpy==${NUMPY}"

echo "[3/3] Comprobacion"
.venv/bin/python -c "import cv2, numpy, onnxruntime as o; print('OpenCV', cv2.__version__, '| numpy', numpy.__version__, '| onnxruntime', o.__version__)"

echo
echo "Camaras detectadas:"
ls /dev/video* 2>/dev/null || echo "  ninguna: conecta la camara web USB"
echo
echo "Listo. Siguiente paso:"
echo "  bash iniciar.sh                 # ventana con la camara (en el escritorio de la Pi)"
echo "  bash iniciar.sh --headless      # por SSH, sin pantalla"
echo "  .venv/bin/python bench.py       # mide la velocidad real"
