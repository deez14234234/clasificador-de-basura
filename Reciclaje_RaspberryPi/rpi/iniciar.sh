#!/usr/bin/env bash
# Arranca el clasificador. Acepta las mismas opciones que detectar.py:
#
#   bash iniciar.sh                       # ventana
#   bash iniciar.sh --pantalla-completa   # monitor dedicado
#   bash iniciar.sh --headless            # por SSH
#   bash iniciar.sh --rapido              # modelo int8, mas fotogramas
#
# Por SSH, para que la ventana salga en el monitor de la Pi:
#   DISPLAY=:0 bash iniciar.sh
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Primero instala: bash instalar.sh" >&2
  exit 1
fi
exec .venv/bin/python detectar.py "$@"
