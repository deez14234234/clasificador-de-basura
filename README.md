# Clasificador de basura — NTP 900.058

Fotografía un residuo y dice en qué contenedor va, según el código de colores
ampliado de la NTP 900.058 (azul, amarillo, blanco, gris, marrón, rojo y
negro).

| Carpeta | Qué contiene |
|---|---|
| [`Reciclaje_basura/`](Reciclaje_basura) | App móvil (Expo), backend (FastAPI) y entrenamiento del modelo principal (EfficientNetV2-S). Incluye el modelo que usa el backend, `artifacts/model_scripted.pt`. |
| [`Reciclaje_RaspberryPi/`](Reciclaje_RaspberryPi) | Versión que corre entera en una Raspberry Pi 4 con cámara web: modelo destilado (EfficientNet-Lite0) y [`paquete_pi/`](Reciclaje_RaspberryPi/paquete_pi), listo para copiar a la Pi. |

Cada carpeta tiene su propio README con el detalle.

## Para el ingeniero

El paquete para la Raspberry Pi 4 está en
[`Reciclaje_RaspberryPi/paquete_pi`](Reciclaje_RaspberryPi/paquete_pi), y
comprimido en el [Release v1.0](https://github.com/deez14234234/clasificador-de-basura/releases/tag/v1.0).
Hace falta Raspberry Pi OS de **64 bits** y una cámara web USB. En la Pi:

```bash
wget https://github.com/deez14234234/clasificador-de-basura/releases/download/v1.0/paquete_pi_reciclaje_rpi4.zip
unzip paquete_pi_reciclaje_rpi4.zip -d ~
cd ~/reciclaje && bash instalar.sh
bash iniciar.sh
```

Por SSH sin pantalla: `bash iniciar.sh --headless`. Las opciones y la solución
de problemas están en
[`paquete_pi/LEEME.md`](Reciclaje_RaspberryPi/paquete_pi/LEEME.md).
