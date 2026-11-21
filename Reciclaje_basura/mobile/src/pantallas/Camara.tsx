import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, clasificar } from '../api';
import {
  Anillo,
  Boton,
  BotonIcono,
  Chip,
  color,
  esquina,
  Icono,
  Pantalla,
  Pulso,
  radio,
  Tacho,
  Texto,
  tonoVisible,
  Visor,
} from '../diseno';
import { entradaDesde, useHistorialCtx } from '../historial';
import type { Props } from '../rutas';
import { useServidorCtx } from '../ServidorContext';
import { useDeteccionEnVivo } from '../useDeteccionEnVivo';

/**
 * Lado largo mínimo de la resolución de captura.
 *
 * En Android esta elección no sólo afecta a la foto: la cámara ajusta también
 * el flujo de vista previa, así que pedir una resolución pequeña deja la
 * pantalla visiblemente pixelada. 1280 px mantiene el preview nítido y un
 * fotograma JPEG de unos 55 KB, que a 4 análisis por segundo es tráfico
 * despreciable en una red local.
 */
const LADO_MINIMO = 1280;

/** Una lectura en vivo "firme": la misma condición que dispara la vibración. */
const CONFIANZA_FIRME = 0.6;
/** Por debajo de esto se considera que el usuario apartó la cámara del objeto. */
const CONFIANZA_SUELTA = 0.45;

function elegirTamano(opciones: string[]): string | undefined {
  const analizadas = opciones
    .map((s) => {
      const [w, h] = s.split('x').map(Number);
      return Number.isFinite(w) && Number.isFinite(h) ? { s, lado: Math.max(w, h) } : null;
    })
    .filter((x): x is { s: string; lado: number } => x !== null)
    .sort((a, b) => a.lado - b.lado);

  if (analizadas.length === 0) return undefined;
  // La más pequeña que llegue al mínimo: nítida sin irse a 4K, que dispararía
  // el tiempo de captura sin que el modelo --que mira 224 px-- lo aproveche.
  return (
    analizadas.find((x) => x.lado >= LADO_MINIMO)?.s ??
    analizadas[analizadas.length - 1].s
  );
}

/**
 * Un solo flujo de escaneo: la cámara lee en vivo y, cuando la lectura se
 * estabiliza, toma sola la foto de calidad y abre el resultado. El obturador
 * permite forzar la foto sin esperar.
 */
export function Camara({ navigation }: Props<'Camara'>) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const { servidor } = useServidorCtx();
  const { agregar } = useHistorialCtx();
  const insets = useSafeAreaInsets();
  const enfocada = useIsFocused();

  const camara = useRef<CameraView>(null);
  const [lista, setLista] = useState(false);
  const [tamano, setTamano] = useState<string | undefined>(undefined);
  const [linterna, setLinterna] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [falloCaptura, setFalloCaptura] = useState<string | null>(null);

  // El bucle se suspende durante una captura: dos capturas simultáneas sobre
  // la misma cámara fallan.
  const activo = enfocada && lista && permiso?.granted === true && !analizando;

  const { lectura, fps, latencia, error } = useDeteccionEnVivo({
    camara,
    servidor,
    activo,
    pictureSize: tamano,
  });

  const alPreparar = useCallback(async () => {
    try {
      const opciones = await camara.current?.getAvailablePictureSizesAsync();
      if (opciones?.length) setTamano(elegirTamano(opciones));
    } catch {
      // Sin lista de tamaños se usa el de por defecto: funciona igual.
    }
    setLista(true);
  }, []);

  // Al alcanzar una lectura estable y segura, un toque háptico avisa sin
  // obligar a mirar la pantalla.
  const yaVibro = useRef<string | null>(null);
  useEffect(() => {
    if (!lectura) {
      yaVibro.current = null;
      return;
    }
    const firme = lectura.estabilidad >= 1 && lectura.confianza >= CONFIANZA_FIRME;
    if (firme && yaVibro.current !== lectura.material) {
      yaVibro.current = lectura.material;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [lectura]);

  /** Captura de calidad con TTA. La usan el obturador y la captura automática. */
  const capturar = useCallback(async () => {
    if (analizando) return;
    setAnalizando(true);
    setFalloCaptura(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const foto = await camara.current?.takePictureAsync({
        base64: true,
        quality: 0.8,
        shutterSound: false,
        imageType: 'jpg',
      });
      if (!foto?.base64 || !foto.uri) {
        throw new Error('La cámara no devolvió una imagen.');
      }
      // Aquí sí vale la pena el TTA: es una sola foto y el usuario está
      // esperando el veredicto bueno.
      const pred = await clasificar(servidor, foto.base64, { tta: true, topk: 3 });
      agregar(entradaDesde(pred, foto.uri));
      Haptics.notificationAsync(
        pred.incierto
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      navigation.navigate('Resultado', { prediccion: pred, fotoUri: foto.uri });
    } catch (err) {
      setFalloCaptura(
        err instanceof ApiError ? err.message : 'No se pudo analizar. Intenta de nuevo.',
      );
    } finally {
      setAnalizando(false);
    }
  }, [analizando, servidor, agregar, navigation]);

  // Captura automática: una sola vez por objeto. Al volver del resultado la
  // cámara sigue viendo lo mismo, así que sólo se vuelve a disparar cuando la
  // lectura cambia de material o el usuario aparta la cámara.
  const disparadoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!lectura || lectura.confianza < CONFIANZA_SUELTA) {
      disparadoPara.current = null;
      return;
    }
    const firme = lectura.estabilidad >= 1 && lectura.confianza >= CONFIANZA_FIRME;
    if (firme && activo && disparadoPara.current !== lectura.material) {
      disparadoPara.current = lectura.material;
      capturar();
    }
  }, [lectura, activo, capturar]);

  const tono = lectura ? tonoVisible(lectura.contenedor.hex) : color.neon;
  const aviso = falloCaptura ?? error;
  const enMarcha = activo && fps > 0;
  const progreso = lectura
    ? Math.min(1, lectura.estabilidad) * Math.min(1, lectura.confianza / CONFIANZA_FIRME)
    : 0;

  if (!permiso) {
    return (
      <Pantalla style={styles.centrado}>
        <ActivityIndicator color={color.neon} size="large" />
      </Pantalla>
    );
  }

  if (!permiso.granted) {
    const bloqueado = !permiso.canAskAgain;
    return (
      <Pantalla style={styles.centrado}>
        <View style={styles.permisoIcono}>
          <Icono nombre="camera-outline" tamano={40} tono={color.neon} />
        </View>
        <Texto nivel="titulo" centrado>
          Permiso de cámara
        </Texto>
        <Texto nivel="cuerpo" tono={color.textoSuave} centrado>
          {bloqueado
            ? 'El permiso está bloqueado. Habilítalo desde los ajustes del teléfono, en la sección de permisos de Expo Go.'
            : 'Necesito la cámara para reconocer el residuo y decirte en qué tacho va.'}
        </Texto>
        {bloqueado ? null : (
          <Boton titulo="Permitir cámara" icono="camera" onPress={pedirPermiso} style={styles.ancho} />
        )}
        <Boton
          titulo="Volver"
          variante="vidrio"
          icono="arrow-back"
          onPress={navigation.goBack}
          style={styles.ancho}
        />
      </Pantalla>
    );
  }

  return (
    <View style={styles.raiz}>
      <CameraView
        ref={camara}
        style={styles.camara}
        facing="back"
        active={enfocada}
        animateShutter={false}
        enableTorch={linterna}
        pictureSize={tamano}
        onCameraReady={alPreparar}
      />

      <View style={[styles.barraSuperior, { top: insets.top + 6 }]} pointerEvents="box-none">
        <BotonIcono icono="close" etiqueta="Cerrar la cámara" onPress={navigation.goBack} />
        <Chip
          texto={enMarcha ? `${fps.toFixed(1)}/s · ${latencia} ms` : analizando ? 'analizando' : 'iniciando'}
          tono={enMarcha ? color.texto : color.textoSuave}
          izquierda={<Pulso tono={enMarcha ? color.neon : color.textoSuave} tamano={7} activo={enMarcha} />}
          style={styles.chipMedidor}
        />
        <BotonIcono
          icono={linterna ? 'flash' : 'flash-outline'}
          etiqueta={linterna ? 'Apagar la linterna' : 'Encender la linterna'}
          onPress={() => setLinterna((v) => !v)}
          activo={linterna}
        />
      </View>

      <View style={styles.zonaMarco} pointerEvents="none">
        <Visor
          tono={tono}
          opacidad={0.55 + 0.45 * (lectura?.estabilidad ?? 0)}
          barriendo={!lectura || analizando}
          style={styles.marco}
        />
        {analizando ? (
          <View style={styles.analizando}>
            <ActivityIndicator color={color.neon} />
            <Texto nivel="cuerpoFuerte">Analizando a fondo…</Texto>
          </View>
        ) : null}
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + 22 }]}>
        {aviso ? (
          <View style={styles.aviso}>
            <Icono nombre="warning-outline" tamano={18} tono={color.error} />
            <Texto nivel="pequeno" tono="#FFD6DE" style={styles.flex}>
              {aviso}
            </Texto>
          </View>
        ) : null}

        <View style={[styles.lectura, { borderColor: lectura ? `${tono}55` : color.borde }]}>
          <Tacho
            hex={lectura?.contenedor.hex ?? '#3A414D'}
            textoHex={lectura?.contenedor.texto_hex ?? '#FFFFFF'}
            ancho={42}
            abierta={progreso >= 1}
          />
          <View style={styles.lecturaTextos}>
            {lectura ? (
              <>
                <Texto nivel="subtitulo" tono={tono} numberOfLines={1}>
                  {lectura.materialLabel}
                </Texto>
                <Texto nivel="pequeno" tono={color.textoSuave} numberOfLines={1}>
                  Tacho {lectura.contenedor.nombre.toLowerCase()} · {Math.round(lectura.confianza * 100)}%
                </Texto>
              </>
            ) : (
              <>
                <Texto nivel="subtitulo">Apunta a un residuo</Texto>
                <Texto nivel="pequeno" tono={color.textoSuave}>
                  Se captura sola cuando la lectura es firme.
                </Texto>
              </>
            )}
          </View>
        </View>

        <View style={styles.zonaObturador}>
          <Pressable
            onPress={capturar}
            disabled={analizando || !lista}
            accessibilityRole="button"
            accessibilityLabel="Tomar la foto ahora y clasificar"
            accessibilityState={{ busy: analizando }}
            style={({ pressed }) => [pressed && styles.obturadorPulsado]}
          >
            <Anillo valor={analizando ? 1 : progreso} tamano={96} grosor={5} tono={tono} pista="rgba(255,255,255,0.22)">
              <View style={[styles.obturador, { backgroundColor: analizando ? tono : color.texto }]}>
                {analizando ? (
                  <ActivityIndicator color={color.fondo} />
                ) : (
                  <Icono nombre="scan" tamano={28} tono={color.fondo} />
                )}
              </View>
            </Anillo>
          </Pressable>
          <Texto nivel="pequeno" tono={color.textoSuave} centrado>
            o toca para capturar ya
          </Texto>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#000' },
  camara: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  flex: { flex: 1 },
  centrado: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  ancho: { alignSelf: 'stretch' },
  permisoIcono: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.neonTenue,
    borderWidth: 1,
    borderColor: 'rgba(198,244,50,0.35)',
    marginBottom: 6,
  },
  barraSuperior: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chipMedidor: { paddingLeft: 4 },
  zonaMarco: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marco: { width: '74%', marginTop: -150 },
  analizando: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: -150,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radio.pildora,
    borderCurve: esquina,
    backgroundColor: color.velo,
    borderWidth: 1,
    borderColor: color.bordeFuerte,
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingHorizontal: 16,
    gap: 16,
    experimental_backgroundImage:
      'linear-gradient(to bottom, rgba(7,9,13,0), rgba(7,9,13,0.94) 32%)',
  },
  lectura: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radio.l,
    borderCurve: esquina,
    borderWidth: 1,
    backgroundColor: color.velo,
  },
  lecturaTextos: { flex: 1, gap: 2 },
  zonaObturador: { alignItems: 'center', gap: 8 },
  obturador: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  obturadorPulsado: { transform: [{ scale: 0.93 }] },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,77,109,0.18)',
    borderColor: 'rgba(255,77,109,0.5)',
    borderWidth: 1,
    borderRadius: radio.m,
    borderCurve: esquina,
    padding: 12,
  },
});
