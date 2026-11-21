import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Aparecer,
  Boton,
  BotonIcono,
  Chip,
  color,
  esquina,
  Icono,
  Pantalla,
  radio,
  Tacho,
  Tarjeta,
  Texto,
  tonoVisible,
} from '../diseno';
import type { Props } from '../rutas';
import { COLOR_POR_KEY, porcentaje } from '../theme';

const ANCHO_TACHO = 150;

/**
 * El resultado es un momento, no una ficha: el tacho del color que toca cae
 * en escena, abre la tapa, la foto del residuo cae dentro y la tapa se cierra.
 * Después aparecen el material, la confianza y el resto de detalles.
 */
export function Resultado({ route, navigation }: Props<'Resultado'>) {
  const { prediccion, fotoUri } = route.params;
  const { contenedor, top, incierto } = prediccion;
  const insets = useSafeAreaInsets();

  // Volver atrás devuelve a la cámara, que reanuda la detección sola al
  // recuperar el foco. Apilar una pantalla nueva dejaría dos cámaras vivas.
  const seguirEscaneando = useCallback(() => navigation.goBack(), [navigation]);
  const alInicio = useCallback(() => navigation.popTo('Principal'), [navigation]);

  const ejemplos = COLOR_POR_KEY[contenedor.color]?.ejemplos;
  const tono = tonoVisible(contenedor.hex);

  // --- Animación de entrada -------------------------------------------------
  const caida = useRef(new Animated.Value(0)).current;
  const foto = useRef(new Animated.Value(0)).current;
  const cifra = useRef(new Animated.Value(0)).current;
  const [abierta, setAbierta] = useState(false);
  const [mostrado, setMostrado] = useState(0);

  useEffect(() => {
    Animated.spring(caida, { toValue: 1, friction: 5, tension: 55, useNativeDriver: true }).start();
    const t1 = setTimeout(() => setAbierta(true), 500);
    const t2 = setTimeout(() => {
      Animated.timing(foto, {
        toValue: 1,
        duration: 650,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, 750);
    const t3 = setTimeout(() => setAbierta(false), 1450);
    const escucha = cifra.addListener(({ value }) => setMostrado(value));
    Animated.timing(cifra, {
      toValue: prediccion.confianza,
      duration: 900,
      delay: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      cifra.removeListener(escucha);
    };
  }, [caida, foto, cifra, prediccion.confianza]);

  // --- Deslizar hacia abajo para seguir escaneando ---------------------------
  const arrastre = useRef(new Animated.Value(0)).current;
  const gestos = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => arrastre.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 1) navigation.goBack();
          else Animated.spring(arrastre, { toValue: 0, friction: 7, useNativeDriver: true }).start();
        },
      }),
    [arrastre, navigation],
  );

  return (
    <Pantalla acento={tono} secundario={tono} intensidad={1.5}>
      <View style={[styles.barra, { paddingTop: insets.top + 8 }]}>
        <BotonIcono icono="chevron-down" etiqueta="Seguir escaneando" onPress={seguirEscaneando} tamano={44} />
        <Texto nivel="etiqueta" tono={color.textoSuave}>
          Resultado
        </Texto>
        <BotonIcono icono="home-outline" etiqueta="Ir al inicio" onPress={alInicio} tamano={44} />
      </View>

      <Animated.View
        style={[
          styles.flex,
          {
            transform: [{ translateY: arrastre }],
            opacity: arrastre.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' }),
          },
        ]}
      >
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View {...gestos.panHandlers} style={styles.escena}>
            <Animated.View
              style={[
                styles.burbuja,
                { borderColor: tono },
                {
                  opacity: foto.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
                  transform: [
                    { translateY: foto.interpolate({ inputRange: [0, 1], outputRange: [0, 150] }) },
                    { scale: foto.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
                  ],
                },
              ]}
            >
              <Image source={{ uri: fotoUri }} style={styles.burbujaFoto} contentFit="cover" />
            </Animated.View>

            <Animated.View
              style={{
                opacity: caida.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                transform: [
                  { translateY: caida.interpolate({ inputRange: [0, 1], outputRange: [-260, 0] }) },
                ],
              }}
            >
              <Tacho hex={contenedor.hex} textoHex={contenedor.texto_hex} ancho={ANCHO_TACHO} abierta={abierta} />
            </Animated.View>
          </View>

          <Aparecer retraso={1000} style={styles.veredicto}>
            <Texto nivel="etiqueta" tono={tono} centrado>
              Tacho {contenedor.nombre} · {contenedor.residuos}
            </Texto>
            <Texto nivel="display" centrado style={styles.material}>
              {prediccion.material_label}
            </Texto>
            <View style={styles.cifra}>
              <Texto nivel="display" tono={tono} style={styles.porcentaje}>
                {Math.round(mostrado * 100)}
              </Texto>
              <Texto nivel="titulo" tono={tono} style={styles.signo}>
                %
              </Texto>
            </View>
            <Chip
              texto={`confianza · ${Math.round(prediccion.ms)} ms`}
              tono={color.textoSuave}
              izquierda={<Icono nombre="flash-outline" tamano={13} tono={color.textoSuave} />}
            />
          </Aparecer>

          {incierto ? (
            <Aparecer retraso={1150} style={styles.aviso}>
              <Icono nombre="warning-outline" tamano={20} tono={color.aviso} />
              <Texto nivel="pequeno" tono="#FFE2A8" style={styles.flex}>
                {prediccion.mensaje ?? 'Confianza baja: acerca más el objeto y repite la foto.'}
              </Texto>
            </Aparecer>
          ) : null}

          {prediccion.consejo ? (
            <Aparecer retraso={1200}>
              <Tarjeta style={styles.consejo}>
                <View style={[styles.consejoIcono, { backgroundColor: `${tono}22` }]}>
                  <Icono nombre="bulb-outline" tamano={20} tono={tono} />
                </View>
                <Texto nivel="cuerpo" style={styles.flex}>
                  {prediccion.consejo}
                </Texto>
              </Tarjeta>
            </Aparecer>
          ) : null}

          {top.length > 1 ? (
            <Aparecer retraso={1300}>
              <Tarjeta style={styles.bloque}>
                <Texto nivel="etiqueta" tono={color.textoSuave}>
                  Otras posibilidades
                </Texto>
                {top.slice(1).map((c) => {
                  const ntp = COLOR_POR_KEY[c.color];
                  return (
                    <View key={c.material} style={styles.candidato}>
                      {ntp ? <Tacho hex={ntp.hex} textoHex={ntp.textoHex} ancho={22} brillo={false} /> : null}
                      <Texto nivel="cuerpoFuerte" style={styles.flex}>
                        {c.label}
                      </Texto>
                      <Texto nivel="dato" tono={color.textoSuave}>
                        {porcentaje.format(c.probabilidad)}
                      </Texto>
                    </View>
                  );
                })}
              </Tarjeta>
            </Aparecer>
          ) : null}

          {ejemplos ? (
            <Aparecer retraso={1400}>
              <Tarjeta style={styles.bloque}>
                <Texto nivel="etiqueta" tono={color.textoSuave}>
                  También va en este tacho
                </Texto>
                <Texto nivel="cuerpo" tono={color.textoSuave}>
                  {ejemplos}
                </Texto>
              </Tarjeta>
            </Aparecer>
          ) : null}
        </ScrollView>
      </Animated.View>

      <View style={[styles.acciones, { paddingBottom: insets.bottom + 16 }]}>
        <Boton titulo="Seguir escaneando" icono="scan" tamano="grande" onPress={seguirEscaneando} />
        <Texto nivel="pequeno" tono={color.textoTenue} centrado>
          o desliza el tacho hacia abajo
        </Texto>
      </View>
    </Pantalla>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  escena: {
    height: ANCHO_TACHO * 1.3 + 120,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  burbuja: {
    position: 'absolute',
    top: 0,
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: color.vidrioAlto,
  },
  burbujaFoto: { width: '100%', height: '100%' },
  veredicto: { alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 6 },
  material: { fontSize: 38, lineHeight: 42 },
  cifra: { flexDirection: 'row', alignItems: 'flex-start' },
  porcentaje: { fontSize: 76, lineHeight: 80, letterSpacing: -3, fontVariant: ['tabular-nums'] },
  signo: { marginTop: 10, marginLeft: 2 },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.avisoTenue,
    borderColor: 'rgba(255,176,32,0.45)',
    borderWidth: 1,
    borderRadius: radio.m,
    borderCurve: esquina,
    padding: 14,
  },
  consejo: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  consejoIcono: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloque: { gap: 12 },
  candidato: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  acciones: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 18,
    experimental_backgroundImage:
      'linear-gradient(to bottom, rgba(7,9,13,0), rgba(7,9,13,0.95) 35%)',
  },
});
