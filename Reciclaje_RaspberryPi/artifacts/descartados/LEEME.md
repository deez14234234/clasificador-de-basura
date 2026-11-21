# Descartados

Aquí sólo quedan historiales de entrenamiento, sin pesos. Se conservan porque
documentan **por qué** el proyecto se quedó con los dos modelos que tiene.

## `historial_mobilenetv3_large_100_224.json`

Descartado pese a ser **el mejor en float32**: con 4,21 M de parámetros igualó
al maestro en validación (macro-F1 0,9650 frente a 0,9648).

El problema aparece al cuantizar. Usa *hard-swish* y bloques
*squeeze-and-excitation*, que no tienen núcleos int8 eficientes, así que ONNX
Runtime acaba insertando conversiones constantes entre enteros y coma
flotante:

| | fp32 | int8 |
|---|---:|---:|
| Exactitud de contenedor | 0,9649 | 0,9347 (**−3,02 p**) |
| Latencia (x86, 4 hilos) | 1,9 ms | 2,9 ms (**más lento**) |

Pierde tres puntos y encima se ralentiza. Para un dispositivo que va a correr
en int8, es el peor de los tres candidatos por los dos lados.

## `mobilenetv4_ronda1_16epocas.json`

Primer entrenamiento de `mobilenetv4_conv_small`, con 16 épocas. Se conserva
para comparar contra el definitivo de 34 épocas, que es el que está en
`artifacts/`.
