/**
 * Detección continua sobre la vista de la cámara.
 *
 * Expo Go no da acceso a los fotogramas del preview (eso necesitaría un
 * *frame processor* nativo y, por tanto, una build propia). Lo que sí permite
 * es capturar rápido: con el sonido y la animación de obturador apagados, y
 * `base64` directo --sin pasar por el manipulador de imágenes-- cada vuelta
 * cuesta unos pocos cientos de milisegundos. Eso da unos 3-4 análisis por
 * segundo, suficiente para que la lectura se sienta continua sobre un objeto
 * quieto.
 *
 * Dos decisiones importantes:
 *
 * 1. **Una petición en vuelo a la vez.** El bucle se reprograma al terminar
 *    cada vuelta, nunca con un intervalo fijo: si la red se pone lenta, baja
 *    la frecuencia sola en vez de acumular peticiones.
 * 2. **Suavizado exponencial** sobre las probabilidades. Fotograma a
 *    fotograma el modelo oscila entre materiales parecidos, y una etiqueta
 *    que parpadea es inservible: promediar las últimas lecturas la estabiliza
 *    sin añadir retardo perceptible.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraView } from 'expo-camera';

import { ApiError, clasificar, type Contenedor, type Prediccion } from './api';

/** Peso de la lectura nueva frente al histórico acumulado. */
const ALFA = 0.45;
/** Vueltas seguidas con el mismo material para considerarlo estable. */
const VUELTAS_ESTABLE = 4;
/** Respiro mínimo entre capturas, para no saturar la cámara. */
const PAUSA_MS = 60;
/** Fallos seguidos antes de avisar al usuario. */
const FALLOS_PARA_AVISAR = 3;
/**
 * Calidad JPEG de los fotogramas. Baja a propósito: el modelo reduce la imagen
 * a 224 px, donde los artefactos de compresión del original son invisibles.
 * Con la captura a 1280 px esto deja el fotograma en unos 55 KB.
 */
const CALIDAD = 0.45;

export type Lectura = {
  material: string;
  materialLabel: string;
  contenedor: Contenedor;
  consejo: string;
  /** Probabilidad ya suavizada, no la del último fotograma suelto. */
  confianza: number;
  /** 0 a 1: cuánto lleva el mismo material encabezando la lista. */
  estabilidad: number;
};

type Opciones = {
  camara: React.RefObject<CameraView | null>;
  servidor: string;
  activo: boolean;
  pictureSize?: string;
};

export function useDeteccionEnVivo({ camara, servidor, activo, pictureSize }: Opciones) {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [fps, setFps] = useState(0);
  const [latencia, setLatencia] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Todo el estado del bucle vive en refs: cambiarlo no debe provocar un
  // render, y el bucle tiene que leer siempre el valor actual.
  const corriendo = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acumulado = useRef<Record<string, number>>({});
  const ultimoMaterial = useRef<string | null>(null);
  const racha = useRef(0);
  const fallos = useRef(0);
  const marcas = useRef<number[]>([]);
  const ultimaPrediccion = useRef<Prediccion | null>(null);

  const reiniciarSuavizado = useCallback(() => {
    acumulado.current = {};
    ultimoMaterial.current = null;
    racha.current = 0;
    marcas.current = [];
    setLectura(null);
    setFps(0);
  }, []);

  useEffect(() => {
    if (!activo) return;

    corriendo.current = true;
    let vivo = true;

    const vuelta = async () => {
      if (!vivo || !corriendo.current) return;
      const cam = camara.current;
      if (!cam) {
        temporizador.current = setTimeout(vuelta, 250);
        return;
      }

      const t0 = Date.now();
      try {
        const foto = await cam.takePictureAsync({
          base64: true,
          quality: CALIDAD,
          // Sin estos dos, cada vuelta dispararía el sonido y el destello del
          // obturador: a varias por segundo sería inusable.
          shutterSound: false,
          imageType: 'jpg',
        });
        if (!vivo || !corriendo.current) return;
        if (!foto?.base64) throw new Error('La cámara no devolvió datos.');

        // topk alto a propósito: el suavizado necesita la distribución
        // completa, no sólo el material ganador.
        const pred = await clasificar(servidor, foto.base64, {
          tta: false,
          topk: 8,
          vivo: true,
        });
        if (!vivo || !corriendo.current) return;

        fallos.current = 0;
        ultimaPrediccion.current = pred;
        setError(null);

        // --- suavizado exponencial sobre las probabilidades ---
        const observado: Record<string, number> = {};
        for (const c of pred.top) observado[c.material] = c.probabilidad;

        const previo = acumulado.current;
        const materiales = new Set([...Object.keys(previo), ...Object.keys(observado)]);
        const mezcla: Record<string, number> = {};
        for (const m of materiales) {
          mezcla[m] = ALFA * (observado[m] ?? 0) + (1 - ALFA) * (previo[m] ?? 0);
        }
        acumulado.current = mezcla;

        let ganador = pred.material;
        let mejor = -1;
        for (const [m, p] of Object.entries(mezcla)) {
          if (p > mejor) {
            mejor = p;
            ganador = m;
          }
        }

        racha.current = ganador === ultimoMaterial.current ? racha.current + 1 : 1;
        ultimoMaterial.current = ganador;

        // El contenedor y los textos se toman de la respuesta cuando coincide
        // con el ganador suavizado; si no, del candidato correspondiente.
        const info =
          pred.material === ganador
            ? {
                materialLabel: pred.material_label,
                contenedor: pred.contenedor,
                consejo: pred.consejo,
              }
            : null;
        const alterno = pred.top.find((c) => c.material === ganador);

        setLectura((anterior) => ({
          material: ganador,
          materialLabel: info?.materialLabel ?? alterno?.label ?? ganador,
          // Si el ganador suavizado no es el del fotograma, no tenemos su
          // ficha de contenedor en esta respuesta: se conserva la anterior
          // hasta que llegue una que la traiga.
          contenedor:
            info?.contenedor ??
            (anterior && anterior.material === ganador
              ? anterior.contenedor
              : (pred.contenedor as Contenedor)),
          consejo: info?.consejo ?? (anterior?.material === ganador ? anterior.consejo : ''),
          confianza: mejor,
          estabilidad: Math.min(1, racha.current / VUELTAS_ESTABLE),
        }));

        // --- ritmo observado, en una ventana corta ---
        const ahora = Date.now();
        marcas.current = [...marcas.current, ahora].filter((t) => ahora - t < 3000);
        setFps(marcas.current.length / 3);
        setLatencia(ahora - t0);
      } catch (err) {
        if (!vivo || !corriendo.current) return;
        fallos.current += 1;
        if (fallos.current >= FALLOS_PARA_AVISAR) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'No se pudo analizar la imagen. Reintentando...',
          );
        }
      } finally {
        if (vivo && corriendo.current) {
          // Tras varios fallos seguidos se espacia el reintento: si el
          // servidor está caído, insistir 4 veces por segundo sólo gasta
          // batería.
          const pausa = fallos.current >= FALLOS_PARA_AVISAR ? 1500 : PAUSA_MS;
          temporizador.current = setTimeout(vuelta, pausa);
        }
      }
    };

    vuelta();

    return () => {
      vivo = false;
      corriendo.current = false;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [activo, servidor, camara, pictureSize]);

  useEffect(() => {
    if (!activo) reiniciarSuavizado();
  }, [activo, reiniciarSuavizado]);

  return { lectura, fps, latencia, error, ultimaPrediccion, reiniciarSuavizado };
}
