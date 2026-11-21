# Clasificador de residuos NTP 900.058 — Raspberry Pi 4 + cámara web

Apunta la cámara a un residuo y el sistema dice en qué tacho va, según el
código de colores ampliado de la NTP 900.058 (azul, amarillo, blanco, gris,
marrón, rojo y negro). Todo corre en la Raspberry Pi: no necesita internet ni
otra computadora.

Es el mismo sistema que la app móvil del proyecto: mismo preprocesamiento,
mismas 8 clases y 7 contenedores, mismo flujo de escaneo.

## Qué hace falta

- Raspberry Pi 4 (2 GB de RAM o más).
- **Raspberry Pi OS de 64 bits** (Bookworm o posterior). En 32 bits no hay
  paquetes de `onnxruntime`.
- Una cámara web USB.
- Monitor para ver la ventana, o acceso por SSH para el modo consola.

## Instalación (una sola vez)

Copia el zip a la Pi (por USB o desde otra computadora) y descomprímelo en
tu carpeta personal; crea `~/reciclaje`:

```bash
scp paquete_pi_reciclaje_rpi4.zip pi@raspberrypi.local:~
ssh pi@raspberrypi.local
unzip ~/paquete_pi_reciclaje_rpi4.zip -d ~
```

En la Pi:

```bash
cd ~/reciclaje
bash instalar.sh
```

Instala OpenCV y numpy con `apt`, crea un entorno virtual en `.venv` e instala
`onnxruntime`. Al final muestra las versiones y las cámaras detectadas.

## Uso

```bash
bash iniciar.sh                       # ventana con la cámara
bash iniciar.sh --pantalla-completa   # para un monitor dedicado
bash iniciar.sh --headless            # por SSH, sin pantalla
DISPLAY=:0 bash iniciar.sh            # por SSH, ventana en el monitor de la Pi
```

### Cómo funciona

1. **Lectura en vivo.** La cámara analiza cada fotograma. Abajo se ve un tacho
   dibujado del color detectado, el material y un anillo de progreso. El
   visor se ilumina con el color del tacho.
2. **Captura automática.** Cuando la lectura es firme (el mismo material
   durante 1 segundo y al menos 60 % de confianza), el anillo se llena y el
   sistema captura solo. Analiza esa imagen con TTA (la imagen y su espejo
   promediados, como el servidor) para un veredicto más fino.
3. **Resultado.** Se muestra la foto congelada con el tacho del color NTP, que
   abre y cierra la tapa, el nombre del contenedor, el material, el
   porcentaje, un consejo y las otras posibilidades. Si la confianza es menor
   de 55 %, avisa que el resultado es dudoso. A los 4 segundos vuelve a la
   cámara.
4. Sólo vuelve a disparar cuando cambias de objeto o apartas la cámara, para
   no repetir la misma captura.

| Tecla | Con ventana | Por consola (`--headless`) |
|---|---|---|
| Capturar ya | ESPACIO | ENTER |
| Cerrar el resultado | ESPACIO | — (se cierra solo) |
| Salir | Q o ESC | Ctrl+C |

Cada resultado se guarda en `historial.csv` (fecha, material, contenedor,
confianza, si fue dudoso y si la captura fue automática o manual). Con
`--guardar-fotos` también se guarda la imagen en `capturas/`.

### Opciones

| Opción | Para qué |
|---|---|
| `--fuente 1` | Otra cámara (o la ruta de un video para probar) |
| `--ancho 320 --alto 240` | Menos resolución, más fotogramas por segundo |
| `--rapido` | Modelo int8: más rápido, 1,6 puntos menos de exactitud |
| `--sin-auto` | Sin captura automática: sólo con ESPACIO / ENTER |
| `--segundos 6` | Cuánto se muestra cada resultado |
| `--hilos 4` | Núcleos que usa el modelo (la Pi 4 tiene 4) |
| `--guardar-fotos` | Guarda cada captura en `capturas/` |

## El modelo

| | `modelo.onnx` (principal) | `modelo_rapido.onnx` (`--rapido`) |
|---|---:|---:|
| Arquitectura | EfficientNet-Lite0, fp32 | EfficientNet-Lite0, int8 |
| Tamaño | 13,5 MB | 3,8 MB |
| Exactitud de material (test) | **96,66 %** | 95,02 % |
| Exactitud de contenedor (test) | **96,98 %** | 95,76 % |

Medido sobre las 1226 imágenes de test. Es un modelo destilado del
EfficientNetV2-S del servidor, que obtiene 96,9 % sobre las mismas imágenes,
pero es 6 veces más pequeño y no necesita GPU.

Para medir la velocidad real en tu Pi:

```bash
.venv/bin/python bench.py
.venv/bin/python bench.py --modelo modelo_rapido.onnx
```

## Problemas comunes

- **"No se pudo abrir la cámara"**: revisa `ls /dev/video*`. Si hay varias,
  prueba `--fuente 1` o `--fuente 2`. `v4l2-ctl --list-devices` dice cuál es
  la webcam.
- **Pocos fotogramas por segundo**: usa `--ancho 320 --alto 240` o
  `--rapido`. Asegúrate de que la Pi tenga buena alimentación (5 V 3 A) y
  disipador: si se calienta, baja la frecuencia.
- **No aparece la ventana**: si entras por SSH, usa `--headless` o
  `DISPLAY=:0`. Sin pantalla el programa pasa solo al modo consola.
- **Resultados dudosos**: un solo objeto, cerca, con buena luz y fondo
  despejado. El modelo aprendió con fotos de un objeto por imagen.
