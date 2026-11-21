# Clasificador de residuos para Raspberry Pi 4 + cámara web

Versión ligera del clasificador NTP 900.058, pensada para correr **entera en
una Raspberry Pi 4**, sin servidor y sin conexión, leyendo de una cámara web
USB.

Es un proyecto hermano de [`../Reciclaje_basura`](../Reciclaje_basura), que
contiene el modelo grande, el dataset y la app móvil. Aquí se reutiliza su
dataset y su modelo entrenado, pero el resultado es un artefacto distinto:
un ONNX de pocos megabytes que se ejecuta en el procesador de la Pi.

---

## 1. Por qué hacía falta otro modelo

El modelo del proyecto principal es un **EfficientNetV2-S**: 80 MB y unos
8 GFLOPs por imagen. En la laptop con GPU eso son 20 ms; en el Cortex-A72 de
una Pi 4, sin acelerador de redes neuronales utilizable, serían **varios
segundos por fotograma**. No es cuestión de optimizar: el presupuesto de
cómputo es dos órdenes de magnitud menor.

| | Proyecto principal | Este proyecto |
|---|---|---|
| Dónde corre el modelo | Laptop con RTX 5060 | La propia Raspberry Pi |
| Arquitectura | EfficientNetV2-S | Red móvil destilada |
| Tamaño | 80 MB | 13,5 MB (fp32) o 3,8 MB (int8) |
| Entrada | Foto desde el teléfono por HTTP | Cámara web USB local |
| Necesita red | Sí, teléfono y laptop | No, funciona aislado |

---

## 2. La estrategia: destilación de conocimiento

Un modelo pequeño entrenado desde cero sobre este dataset se queda bastante
por debajo del grande. La alternativa que se usó aquí es **destilación**: el
EfficientNetV2-S actúa de *maestro* y el modelo pequeño de *alumno*.

La diferencia con el entrenamiento normal es de qué aprende el alumno. Con
etiquetas duras, una foto de una caja es simplemente «cartón». Con
destilación, el alumno ve la distribución completa del maestro —por ejemplo
«cartón 0,70 · papel 0,25 · no aprovechable 0,03»— y eso le transmite algo que
la etiqueta no dice: **que el cartón y el papel se parecen, y que ninguno se
parece al vidrio**. Esa estructura entre clases es información gratuita que
acelera y mejora el aprendizaje del alumno.

La función de pérdida combina las dos señales:

```
pérdida = 0,75 · KL(alumno_suave ‖ maestro_suave) · T²  +  0,25 · CE(alumno, etiqueta)
```

Dos detalles que importan:

- **Temperatura T = 4.** Suaviza las probabilidades del maestro. Con T = 1
  casi todo el peso se concentra en la clase ganadora y la destilación deja de
  aportar: justamente la información útil está en las clases que *no* ganan.
  El factor T² mantiene la magnitud del gradiente comparable a la de la
  pérdida dura al cambiar T.
- **El maestro ve exactamente la misma imagen aumentada que el alumno.** Se
  ejecuta en línea, en modo evaluación y sin gradientes. Si viera otra vista
  de la imagen, sus logits no describirían la que el alumno está mirando y la
  señal sería ruido.

Se mantienen del proyecto principal los pesos por clase (≈ 1/√frecuencia, por
el desbalance entre vidrio y peligrosos) y la selección del mejor modelo por
**macro-F1**, no por exactitud: con clases desbalanceadas la exactitud premia
acertar vidrio e ignorar las clases pequeñas.

---

## 3. Los candidatos

No se eligió una arquitectura a ojo: se entrenaron tres y se decidió con
medidas. Las tres están diseñadas para CPU móvil, que es exactamente el caso
de la Pi.

| Arquitectura | Parámetros | Por qué está en la lista |
|---|---:|---|
| `mobilenetv4_conv_small` | 2,50 M | Lo más reciente de la familia MobileNet, optimizada para CPU móvil |
| `efficientnet_lite0` | 3,38 M | Variante *lite* creada para el borde: sin bloques SE y con ReLU6 en lugar de swish, precisamente para que **cuantice bien** |
| `mobilenetv3_large_100` | 4,21 M | La referencia clásica del sector; sirve de control |

El detalle de `efficientnet_lite0` no es menor. Los bloques *squeeze and
excitation* y las activaciones tipo swish mejoran la exactitud en coma
flotante pero se degradan al pasar a enteros de 8 bits. Las variantes *lite*
los eliminan a propósito. Por eso un modelo que parece peor en fp32 puede
acabar ganando en int8, que es la precisión en la que va a correr.

---

## 4. Cuantización a int8

El modelo se exporta a ONNX y se cuantiza a enteros de 8 bits. En ARM esto
hace dos cosas: reduce el archivo a una cuarta parte y, sobre todo, permite
usar las instrucciones NEON de enteros, bastante más rápidas que las de coma
flotante. Lo típico es 2-3× de velocidad a cambio de unas décimas de
exactitud.

Se usa cuantización **estática**, no dinámica. La dinámica es más cómoda
—no necesita datos— pero recalcula los rangos de las activaciones en cada
inferencia, y en redes convolucionales eso se come casi toda la ganancia. La
estática los fija de antemano calibrando con imágenes reales.

Detalles de la calibración:

- **320 imágenes** del conjunto de entrenamiento, tomadas con un paso
  uniforme sobre el índice. Recorrer las primeras 320 daría sólo cartón: la
  calibración tiene que ver los ocho materiales.
- Pasan por **el mismo preprocesamiento que en inferencia**. Calibrar con
  imágenes sin normalizar daría rangos que no se parecen a los que verá la Pi.
- Pesos `int8` **por canal** y activaciones `uint8`: es la combinación mejor
  soportada por los núcleos ARM de ONNX Runtime.
- Antes de cuantizar se ejecuta `quant_pre_process`, que infiere formas y
  simplifica el grafo. Sin ese paso muchos nodos se quedan sin cuantizar y la
  ganancia se evapora.

---

## 5. Resultados

Lo que no se conservó está documentado en `artifacts/descartados/LEEME.md`.

> **Corrección (20-11-2026).** Las cifras int8 que daba antes esta sección
> (97,06 % de contenedor, 96,57 % de material) no se reproducen. Medido de
> nuevo sobre las mismas 1226 imágenes de test, con onnxruntime 1.20 y 1.32
> (mismo resultado en las dos), el `efficientnet_lite0_224_int8.onnx` que se
> empaquetaba daba **92,58 %** de material: la cuantización del grafo entero
> le costaba 4 puntos. El fp32 sí da lo esperado (96,66 %), así que las cifras
> anteriores probablemente se tomaron sobre el fp32.
>
> Cambiar el método de calibración no lo arregla (Percentile 92,99 %,
> Entropy 92,90 %); dejar en fp32 las depthwise lo empeora (57 %). Lo que sí
> funciona es dejar en fp32 **la primera convolución y el clasificador
> final**: 95,02 %, con el mismo tamaño. `ml/exportar.py` lo hace ahora por
> defecto.
>
> Como en la Pi 4 el fp32 es de sobra rápido para la cámara en vivo, el
> paquete usa ahora **el fp32 como modelo principal** y el int8 corregido
> como opción `--rapido`.

### El modelo principal

**`efficientnet_lite0`** destilado, en fp32. Es el que arma
`ml/preparar_pi.py --auto` en `paquete_pi/modelo.onnx`; el int8 corregido va
en `paquete_pi/modelo_rapido.onnx`.

| | fp32 (principal) | int8 (`--rapido`) |
|---|---:|---:|
| Tamaño | 13,5 MB | 3,8 MB |
| Exactitud de material (test) | **96,66 %** | 95,02 % |
| Exactitud de contenedor (test) | **96,98 %** | 95,76 % |
| Latencia en x86 (4 hilos) | 6,4 ms | 4,5 ms |
| Parámetros | 3,38 M | 3,38 M |
| Entrenamiento | 34 épocas, 20,8 min en una RTX 5060 | |

Comparado con el maestro del que se destiló, sobre las mismas 1226 imágenes:

| | Maestro (EfficientNetV2-S) | Alumno fp32 | Diferencia |
|---|---:|---:|---:|
| Material | 96,9 % | 96,66 % | −0,2 p |
| Tamaño | 80 MB | 13,5 MB | **6× menor** |

Dos décimas de exactitud a cambio de seis veces menos tamaño, y pasar de
necesitar una GPU a correr en el procesador de una Pi.

### La alternativa ligera

**`mobilenetv4_conv_small`** int8. Con la medición de 20-11-2026 da 91,11 %
de material y 92,17 % de contenedor (antes figuraba 93,2 % y 94,1 %), y se
cuantizó con el método anterior. Antes de usarla conviene probar
`--rapido` con el lite0 int8 corregido (95,02 %), que es más exacto con un
tamaño parecido. Para cambiarla:

```powershell
python ml\preparar_pi.py --modelo artifacts\mobilenetv4_conv_small_224_int8.onnx
```

### Por qué se descartó el que parecía mejor

Esta es la parte que no se puede decidir sin medir. Los tres candidatos se
entrenaron igual (16 épocas) y se cuantizaron igual:

| Arquitectura | fp32 | int8 | Pérdida | ms fp32 | ms int8 |
|---|---:|---:|---:|---:|---:|
| efficientnet_lite0 | 0,9608 | **0,9584** | −0,24 p | 2,5 | **1,7** |
| mobilenetv4_conv_small | 0,9437 | 0,9356 | −0,82 p | 1,1 | 0,8 |
| mobilenetv3_large_100 | **0,9649** | 0,9347 | **−3,02 p** | 1,9 | **2,9** |

`mobilenetv3_large_100` **era el mejor en float32**: con 4,21 M de parámetros
igualó al maestro en validación (macro-F1 0,9650 frente a 0,9648). Pero al
cuantizar pierde **tres puntos enteros** y encima se vuelve *más lento* que en
fp32.

No es una anomalía, es lo que anticipaba la sección 3: MobileNetV3 usa
*hard-swish* y bloques *squeeze-and-excitation*, que no tienen núcleos int8
eficientes, así que ONNX Runtime acaba insertando conversiones constantes
entre enteros y coma flotante. `efficientnet_lite0` es justo la variante que
elimina ambas cosas a propósito para el borde.

**Si la elección se hubiera hecho por la exactitud en float32, se habría
desplegado el peor de los tres.**

### El entrenamiento largo sí valió la pena

Los tres candidatos alcanzaron su mejor época en la última de 16, señal de que
seguían mejorando. Repetidos con 34 épocas (validación, macro-F1):

| | 16 épocas | 34 épocas |
|---|---:|---:|
| efficientnet_lite0 | 0,9530 | **0,9578** |
| mobilenetv4_conv_small | 0,9290 | **0,9339** |

A partir de la época 29 la curva se aplana, así que 34 es suficiente.

Entre medias hubo un intento fallido que conviene documentar porque es una
trampa fácil: 34 épocas **con parada temprana** dieron 0,9370, es decir 1,6
puntos *menos* que 16 épocas completas. La causa es la interacción entre el
coseno y la paciencia: la tasa de aprendizaje recorre todas las épocas, así
que el modelo no converge hasta que la tasa baja, cerca del final. La parada
por paciencia mide el progreso justo en la fase de tasa alta, donde las
métricas rebotan sin tendencia, y cortó en la época 12. Por eso **la parada
temprana está desactivada por defecto** en `destilar.py`.

### Verificación con el código real del dispositivo

Las cifras de arriba salen del pipeline de evaluación. Para descartar que el
código que corre en la Pi se comporte distinto, se cargó cada paquete con la
clase `Clasificador` de su `detectar.py` y se le pasaron las 1226 imágenes de
test convertidas a fotogramas de 640×480 (ampliadas a 480 px y rellenadas a
los lados, como un objeto centrado frente a una cámara web):

| Paquete | Fotogramas 640×480 |
|---|---:|
| Anterior (int8, lectura de un fotograma) | 88,91 % |
| Actual, `modelo.onnx` (fp32, captura con TTA) | **94,62 %** |
| Actual, `modelo_rapido.onnx` (int8, captura con TTA) | 93,31 % |

Con las imágenes de test originales (240×240), el `detectar.py` actual con TTA
da 96,25 %, a la par del pipeline. Los fotogramas sintéticos son algo más
difíciles que el test por el relleno añadido, así que lo que importa es la
comparación entre paquetes.

### Latencia

`bench.py` sobre fotogramas de 640×480:

| | Preproceso | Inferencia | Total |
|---|---:|---:|---:|
| x86, 4 hilos, fp32 | 2,8 ms | 7,2 ms | 10,3 ms |
| x86, 4 hilos, int8 | | 5,4 ms | 9,1 ms |
| Raspberry Pi 4 | *medir con `bench.py`* | | *estimado 4-8×* |

Dos cosas que importan. Primero, **el preprocesado ya pesa el 40 % del total**,
y en la Pi ese reparto empeora porque el redimensionado también se ralentiza:
si los fotogramas por segundo se quedan cortos allí, bajar la resolución de
captura rendirá más que cambiar de modelo. Segundo, la estimación de 4-8× es
eso, una estimación; la cifra real sale de correr `bench.py` en el
dispositivo.

---

## 6. Entrenar de nuevo

Requisitos previos: el dataset preparado y el modelo maestro entrenado, ambos
en el proyecto principal.

```powershell
cd ..\Reciclaje_basura
python ml\fetch_hazardous.py
python ml\prepare_dataset.py --clean --battery-zip data\external\battery.zip
python ml\train.py
```

Después, desde esta carpeta:

```powershell
python ml\destilar.py --arch mobilenetv4_conv_small --epochs 16
```

```powershell
python ml\exportar.py --checkpoint artifacts\mobilenetv4_conv_small_224.pt
```

```powershell
python ml\comparar.py
```

```powershell
python ml\preparar_pi.py --auto
```

El último comando deja en `paquete_pi/` sólo lo que va al dispositivo: el
ONNX, sus metadatos y los dos scripts. Unos pocos megabytes en total.

Opciones útiles de `destilar.py`:

| Opción | Por defecto | Para qué |
|---|---|---|
| `--arch` | `mobilenetv4_conv_small` | Cualquier modelo de `timm` |
| `--img-size` | `224` | Bajar a 192 o 160 acelera mucho en la Pi |
| `--epochs` | `20` | Con destilación converge rápido |
| `--alfa` | `0.75` | Peso de la destilación frente a las etiquetas |
| `--temperatura` | `4.0` | Suavizado de las probabilidades del maestro |

---

## 7. Desplegar en la Raspberry Pi

La guía completa para quien instala está en `paquete_pi/LEEME.md`, que viaja
con el paquete. En resumen, con **Raspberry Pi OS de 64 bits** (en 32 bits no
hay paquetes de `onnxruntime`):

```bash
scp -r paquete_pi pi@raspberrypi.local:~/reciclaje
ssh pi@raspberrypi.local
cd ~/reciclaje
bash instalar.sh          # apt + entorno virtual + onnxruntime
.venv/bin/python bench.py # latencia real
bash iniciar.sh           # cámara en vivo (--headless por SSH)
```

Por qué `instalar.sh` y no `pip3 install -r requirements.txt` como antes:
desde Raspberry Pi OS Bookworm, pip no deja instalar en el Python del sistema
(PEP 668), y `opencv-python-headless` no puede abrir ventanas. El script usa
el OpenCV y el numpy de `apt`, que traen soporte de ventanas y están
compilados para la Pi, dentro de un entorno virtual donde sólo se instala
`onnxruntime`.

### Qué se ve

El mismo flujo que la app móvil:

1. **Lectura en vivo**: visor de escáner del color del tacho detectado, abajo
   un tacho dibujado de ese color, el material y un anillo que se llena a
   medida que la lectura se estabiliza.
2. **Captura automática** cuando la lectura es firme (el mismo material
   durante 1 s y al menos 60 % de confianza, los mismos umbrales que la app).
   Esa imagen se analiza con TTA (imagen + espejo, como el backend).
3. **Resultado**: foto congelada con el tacho del color NTP, que abre y cierra
   la tapa, contenedor, material, porcentaje, consejo y alternativas. Por
   debajo de 55 % de confianza se marca como dudoso, igual que el backend.
4. No vuelve a disparar hasta que cambia el objeto o se aparta la cámara.

ESPACIO captura sin esperar, Q sale. En `--headless` se imprime una línea por
segundo y un bloque por cada resultado; ENTER captura. Cada resultado se
anota en `historial.csv` (y la foto en `capturas/` con `--guardar-fotos`).

Las opciones (`--rapido`, `--pantalla-completa`, `--sin-auto`, `--fuente`,
`--ancho`/`--alto`, `--segundos`…) están en `paquete_pi/LEEME.md`.

---

## 8. Decisiones del código del dispositivo

**El preprocesamiento replica el del entrenamiento, pero con OpenCV.** Esto
es lo más fácil de romper sin enterarse: el modelo aprendió con imágenes
ajustadas a 240×240 con bordes reflejados y recortadas al centro a 224. Si la
Pi recortara el centro de un fotograma 640×480, el modelo vería un dominio
distinto y la exactitud caería sin dar ninguna señal de error.

Se verificó que ambos caminos coinciden:

| Caso | Diferencia máxima | ¿Misma predicción? |
|---|---:|---|
| Imágenes cuadradas 240×240 (el dataset) | 0,0000 | — |
| Fotogramas 640×480 de webcam | 2,77 | **100 %** (200 imágenes) |

La diferencia en el segundo caso viene del método de remuestreo —PIL usa
BICUBIC y OpenCV `INTER_AREA`— pero no cambia ni una sola predicción, y
`INTER_AREA` es además el remuestreo correcto al reducir, porque promedia en
vez de tomar muestras sueltas. Se comprobó también `INTER_CUBIC`: mismo
resultado.

El relleno usa `BORDER_REFLECT_101`, que es el modo `reflect` de numpy con el
que se entrenó: refleja sin repetir el píxel del borde. Hasta el 20-11-2026 se
usaba `BORDER_REFLECT`, que sí lo repite. La diferencia es de un píxel en el
borde del relleno, pero ahora el camino coincide exactamente con el del
entrenamiento.

**Suavizado temporal.** El mismo de la app móvil, por la misma razón:
fotograma a fotograma el modelo oscila entre materiales parecidos, y una
etiqueta que parpadea es inservible. Se promedian las probabilidades con
α = 0,45.

**Buffer de cámara a 1 fotograma.** Sin eso OpenCV acumula imágenes y se
acaba analizando algo que pasó hace un segundo.

**El código del dispositivo no importa nada del entrenamiento.** Sólo necesita
`numpy`, `opencv` y `onnxruntime`. La taxonomía completa —materiales, colores,
consejos— viaja dentro del JSON de metadatos, así que la Pi no depende de
ningún archivo de Python del proyecto.

---

## 9. ¿Se puede mejorar más?

Sí, pero el margen que queda **no está donde uno esperaría**. Ordenado por lo
que de verdad rinde:

### Lo que más daría

**1. Datos del entorno real.** Con diferencia, la mayor palanca. El dataset
es casi todo fotos limpias de catálogo sacadas de la web; la cámara de la Pi
va a ver fondos desordenados, sombras, objetos arrugados y luz de
fluorescente. Unas 300-500 fotos por material tomadas *con la propia Pi, en
el sitio donde va a funcionar*, y un ajuste fino encima, valen más que
cualquier cambio de arquitectura. Es la única vía que puede subir varios
puntos.

**2. Entrenamiento consciente de la cuantización (QAT).** Aquí se cuantiza
*después* de entrenar. Entrenar ya simulando los enteros de 8 bits recupera
buena parte de lo que se pierde al convertir: entre +0,3 y +1 punto según el
caso. Es la mejora técnica con mejor relación esfuerzo/resultado, y en este
proyecto tiene un atractivo extra: haría viable `mobilenetv3_large_100`, que
en fp32 es el mejor de los tres pero se desploma al cuantizar.

**3. Maestro en conjunto.** Destilar del promedio de dos o tres maestros en
lugar de uno suele dar +0,5 a +1 punto en el alumno, sin que el alumno crezca
ni un byte. Habría que entrenar esos maestros, eso sí.

### Palancas, no mejoras

**Resolución.** Subir de 224 a 288 px daría algo de exactitud a cambio de casi
el doble de cómputo; bajar a 160 haría lo contrario. No es una mejora, es un
intercambio: la decisión correcta depende de los milisegundos que mida
`bench.py` en tu Pi.

**Cambiar de runtime.** `ncnn` o TFLite con XNNPACK a veces superan a ONNX
Runtime en ARM por 1,3-2×. No mejora la exactitud, pero libera presupuesto
para subir la resolución, que sí la mejora.

### Lo que no recomiendo

**Una arquitectura más grande** es justo lo contrario de lo que se busca
aquí. Y **podar el modelo** suena bien, pero ONNX Runtime en ARM no aprovecha
la dispersión no estructurada, así que la ganancia real es casi nula.

### El techo práctico

El maestro está en 96,8 % por material y 97,4 % por contenedor. Esa segunda
cifra es la que importa: casi toda la confusión es papel ↔ cartón, y ambos
van al mismo tacho azul, así que al usuario no le afecta.

En destilación el alumno rara vez supera al maestro, así que **ese ~97 % es el
techo mientras no cambien los datos**. El alumno elegido ya está a **0,33
puntos** de ahí con una vigésima parte del tamaño, así que por este camino
queda prácticamente nada que rascar. Dicho de otro modo: el
margen que queda en arquitectura son décimas; el que queda en datos son
puntos.

### Si quieres un salto de verdad

Un **acelerador Coral USB** (unos 60-70 USD) multiplica por 10-50 la capacidad
de cómputo de la Pi. Con ese presupuesto cabría un modelo mucho mayor —casi el
maestro— con fotogramas de sobra. Si el montaje va a quedarse instalado en
algún sitio, es la inversión que más cambia el resultado.

---

## 10. Estructura

```
Reciclaje_RaspberryPi/
├── ml/                              # todo esto se queda en la laptop
│   ├── taxonomy.py                  # copia de la taxonomía NTP del proyecto principal
│   ├── imaging.py                   # copia del preprocesamiento, para entrenar y validar
│   ├── destilar.py                  # entrenamiento del alumno con el maestro
│   ├── exportar.py                  # ONNX + cuantización int8 estática
│   ├── comparar.py                  # exactitud, tamaño y latencia de cada modelo
│   └── preparar_pi.py               # arma el paquete que se copia al dispositivo
├── rpi/                             # fuente de lo que corre en la Pi
│   ├── detectar.py                  # cámara en vivo, captura automática y resultado
│   ├── bench.py                     # latencia real en el dispositivo
│   ├── instalar.sh                  # apt + entorno virtual + onnxruntime
│   ├── iniciar.sh                   # arranca detectar.py desde el entorno virtual
│   ├── LEEME.md                     # guía para quien instala la Pi
│   └── requirements.txt
├── artifacts/
│   ├── efficientnet_lite0_224*      # modelo principal: pesos, fp32, int8 y metadatos
│   ├── mobilenetv4_conv_small_224*  # alternativa ligera (cuantización antigua)
│   ├── historial_*.json             # curvas de entrenamiento
│   ├── comparativa_test.json        # medidas antiguas (ver la corrección de la sección 5)
│   └── descartados/                 # historiales de lo que no se conservó, y por qué
└── paquete_pi/                      # lo único que se copia a la Pi (~17 MB)
    ├── modelo.onnx                  # fp32, principal
    ├── modelo_rapido.onnx           # int8, opción --rapido
    ├── modelo_meta.json
    ├── detectar.py, bench.py
    ├── instalar.sh, iniciar.sh
    ├── LEEME.md
    └── requirements.txt
```

Sobre lo que **no** está en la carpeta:

- **No hay copias de seguridad de entrenamientos anteriores.** Lo que
  documentaba cada intento era su historial, y esos sí se conservan.

`taxonomy.py` e `imaging.py` son copias del proyecto principal. Para que no se
desincronicen en silencio, `destilar.py` **falla al arrancar** si las clases
del maestro no coinciden con las de esta taxonomía.

---

## 11. Créditos

Mismos datos que el proyecto principal: *Clasificación de Basura* v4 de
Roboflow Universe (CC BY 4.0) y la clase `battery` del dataset *Garbage
Classification (12 classes)* vía Hugging Face. Ver el README principal para
los enlaces y el detalle de cómo se reconstruyó el dataset.
