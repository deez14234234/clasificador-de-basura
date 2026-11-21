import { useCallback, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PanelAjustes } from '../componentes/PanelAjustes';
import { PuntoServidor } from '../componentes/PuntoServidor';
import {
  ALTO_BARRA,
  Aparecer,
  Boton,
  BotonIcono,
  BotonTexto,
  color,
  esquina,
  Hoja,
  Icono,
  Pantalla,
  radio,
  sombra,
  Tacho,
  Texto,
  tonoVisible,
} from '../diseno';
import { useHistorialCtx, type Entrada } from '../historial';
import type { PropsPestana } from '../rutas';
import { useServidorCtx } from '../ServidorContext';
import { COLORES_NTP, porcentaje, type ColorNTP } from '../theme';

/** Los 7 tachos en dos estantes: 4 arriba y 3 abajo. */
const ESTANTES = [COLORES_NTP.slice(0, 4), COLORES_NTP.slice(4)];

/**
 * Menú principal: los siete tachos de la NTP dibujados en una estantería.
 * Tocar uno abre su tapa y una hoja con lo que va dentro, así que la guía de
 * colores es la propia pantalla de inicio y funciona sin conexión.
 */
export function Inicio({ navigation }: PropsPestana<'Inicio'>) {
  const { estado, comprobar } = useServidorCtx();
  const { entradas } = useHistorialCtx();
  const insets = useSafeAreaInsets();

  const [elegido, setElegido] = useState<ColorNTP | null>(null);
  const [ajustes, setAjustes] = useState(false);
  // La hoja sigue mostrando el último tacho mientras baja al cerrarse.
  const ultimo = useRef<ColorNTP | null>(null);
  if (elegido) ultimo.current = elegido;

  const abrirTacho = useCallback((c: ColorNTP) => {
    Haptics.selectionAsync().catch(() => {});
    setElegido(c);
  }, []);

  const irACamara = useCallback(() => {
    setElegido(null);
    navigation.navigate('Camara');
  }, [navigation]);

  const recientes = entradas.slice(0, 8);

  return (
    <Pantalla>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 10, paddingBottom: insets.bottom + ALTO_BARRA + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.barra}>
          <View style={styles.marca}>
            <View style={styles.logo}>
              <Icono nombre="leaf" tamano={16} tono={color.sobreNeon} />
            </View>
            <Texto nivel="subtitulo">
              recicla<Texto nivel="subtitulo" tono={color.neon}>.ntp</Texto>
            </Texto>
          </View>
          <View style={styles.barraDerecha}>
            <PuntoServidor estado={estado} onPress={comprobar} />
            <BotonIcono
              icono="settings-outline"
              etiqueta="Ajustes"
              onPress={() => setAjustes(true)}
              tamano={40}
            />
          </View>
        </View>

        <Aparecer style={styles.hero}>
          <Texto nivel="display">
            ¿En qué{' '}
            <Texto nivel="display" tono={color.neon}>
              tacho
            </Texto>{' '}
            va?
          </Texto>
          <Texto nivel="cuerpo" tono={color.textoSuave}>
            Toca un tacho para ver qué residuos van dentro, o pulsa{' '}
            <Texto nivel="cuerpoFuerte" tono={color.neon}>
              escanear
            </Texto>{' '}
            y la cámara te lo dice.
          </Texto>
        </Aparecer>

        {estado === 'caido' ? (
          <Pressable onPress={comprobar} style={styles.avisoCaido} accessibilityRole="button">
            <Icono nombre="cloud-offline-outline" tamano={18} tono={color.error} />
            <Texto nivel="pequeno" tono="#FFD6DE" style={styles.flex}>
              No encuentro el servidor. Enciende el backend en la laptop o revisa Ajustes.
            </Texto>
            <Texto nivel="pequeno" tono={color.error} style={styles.reintentar}>
              Reintentar
            </Texto>
          </Pressable>
        ) : null}

        <View style={styles.estanteria}>
          {ESTANTES.map((fila, f) => (
            <View key={f} style={styles.estante}>
              <View style={styles.filaTachos}>
                {fila.map((c, i) => (
                  <TachoEstante
                    key={c.key}
                    c={c}
                    abierto={elegido?.key === c.key}
                    retraso={120 + (f * 4 + i) * 70}
                    onPress={abrirTacho}
                  />
                ))}
              </View>
              <View style={styles.repisa} />
            </View>
          ))}
        </View>

        <View style={styles.seccion}>
          <View style={styles.seccionCabecera}>
            <Texto nivel="etiqueta" tono={color.textoSuave}>
              Últimos escaneos
            </Texto>
            {entradas.length > 0 ? (
              <BotonTexto titulo="Ver todo" onPress={() => navigation.navigate('Historial')} />
            ) : null}
          </View>
          {recientes.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carrusel}
              style={styles.carruselMarco}
            >
              {recientes.map((e) => (
                <TarjetaReciente key={e.id} entrada={e} />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.vacio}>
              <Icono nombre="scan-outline" tamano={22} tono={color.textoTenue} />
              <Texto nivel="pequeno" tono={color.textoSuave} style={styles.flex}>
                Aún no escaneas nada. Pulsa el botón central para empezar.
              </Texto>
            </View>
          )}
        </View>
      </ScrollView>

      <Hoja visible={elegido !== null} onCerrar={() => setElegido(null)}>
        {ultimo.current ? <DetalleTacho c={ultimo.current} onEscanear={irACamara} /> : null}
      </Hoja>

      <Hoja visible={ajustes} onCerrar={() => setAjustes(false)} titulo="Ajustes">
        <PanelAjustes onCerrar={() => setAjustes(false)} />
      </Hoja>
    </Pantalla>
  );
}

/** Un tacho de la estantería: entra en cascada y rebota al tocarlo. */
function TachoEstante({
  c,
  abierto,
  retraso,
  onPress,
}: {
  c: ColorNTP;
  abierto: boolean;
  retraso: number;
  onPress: (c: ColorNTP) => void;
}) {
  const escala = useRef(new Animated.Value(1)).current;
  const resorte = (a: number) =>
    Animated.spring(escala, { toValue: a, friction: 4, tension: 160, useNativeDriver: true }).start();

  return (
    <Aparecer retraso={retraso} desde={40} style={styles.celda}>
      <Pressable
        onPress={() => onPress(c)}
        onPressIn={() => resorte(0.9)}
        onPressOut={() => resorte(1)}
        accessibilityRole="button"
        accessibilityLabel={`Tacho ${c.nombre}: ${c.residuos}`}
        style={styles.celdaToque}
      >
        <Animated.View style={{ transform: [{ scale: escala }] }}>
          <Tacho hex={c.hex} textoHex={c.textoHex} ancho={62} abierta={abierto} />
        </Animated.View>
        <Texto nivel="pequeno" tono={tonoVisible(c.hex)} style={styles.nombreTacho} numberOfLines={1}>
          {c.nombre}
        </Texto>
      </Pressable>
    </Aparecer>
  );
}

/** Contenido de la hoja de un tacho. */
function DetalleTacho({ c, onEscanear }: { c: ColorNTP; onEscanear: () => void }) {
  const tono = tonoVisible(c.hex);
  return (
    <View style={styles.detalle}>
      <View style={styles.detalleCabecera}>
        <Tacho hex={c.hex} textoHex={c.textoHex} ancho={104} abierta />
        <View style={styles.detalleTextos}>
          <Texto nivel="etiqueta" tono={tono}>
            Tacho {c.nombre}
          </Texto>
          <Texto nivel="titulo">{c.residuos}</Texto>
        </View>
      </View>

      <View style={[styles.detalleBloque, { borderColor: `${tono}40` }]}>
        <View style={styles.detalleFila}>
          <Icono nombre="checkmark-circle" tamano={18} tono={tono} />
          <Texto nivel="etiqueta" tono={color.textoSuave}>
            Qué va aquí
          </Texto>
        </View>
        <Texto nivel="cuerpo">{c.ejemplos}</Texto>
      </View>

      {c.key === 'rojo' ? (
        <View style={styles.detalleAviso}>
          <Icono nombre="alert-circle-outline" tamano={18} tono={color.error} />
          <Texto nivel="pequeno" tono="#FFD6DE" style={styles.flex}>
            Necesita punto de acopio especial: no lo mezcles con el resto.
          </Texto>
        </View>
      ) : null}

      <Boton titulo="Escanear un residuo" icono="scan" onPress={onEscanear} />
    </View>
  );
}

function TarjetaReciente({ entrada }: { entrada: Entrada }) {
  return (
    <View style={styles.reciente}>
      <Image source={{ uri: entrada.fotoUri }} style={styles.recienteFoto} contentFit="cover" transition={120} />
      <View style={styles.recienteTacho}>
        <Tacho hex={entrada.hex} textoHex={entrada.textoHex} ancho={22} brillo={false} />
      </View>
      <View style={styles.recienteTextos}>
        <Texto nivel="pequeno" numberOfLines={1} style={styles.recienteMaterial}>
          {entrada.materialLabel}
        </Texto>
        <Texto nivel="pequeno" tono={color.textoTenue}>
          {porcentaje.format(entrada.confianza)}
        </Texto>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 22 },
  barra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barraDerecha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderCurve: esquina,
    backgroundColor: color.neon,
    alignItems: 'center',
    justifyContent: 'center',
    ...sombra.neon,
  },
  hero: { gap: 10, paddingTop: 6 },
  avisoCaido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radio.m,
    borderCurve: esquina,
    backgroundColor: color.errorTenue,
    borderWidth: 1,
    borderColor: 'rgba(255,77,109,0.35)',
  },
  reintentar: { fontFamily: 'SpaceGrotesk_600SemiBold' },
  estanteria: {
    gap: 6,
    paddingVertical: 18,
    paddingHorizontal: 8,
    borderRadius: radio.l,
    borderCurve: esquina,
    backgroundColor: color.vidrio,
    borderWidth: 1,
    borderColor: color.borde,
  },
  estante: { gap: 0 },
  filaTachos: { flexDirection: 'row', justifyContent: 'center' },
  repisa: {
    height: 2,
    marginHorizontal: 10,
    marginTop: 2,
    marginBottom: 10,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  celda: { width: '25%', alignItems: 'center' },
  celdaToque: { alignItems: 'center', gap: 6, paddingTop: 16 },
  nombreTacho: { fontFamily: 'SpaceGrotesk_600SemiBold' },
  seccion: { gap: 12 },
  seccionCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  carruselMarco: { marginHorizontal: -20 },
  carrusel: { paddingHorizontal: 20, gap: 12 },
  reciente: {
    width: 132,
    borderRadius: radio.m,
    borderCurve: esquina,
    overflow: 'hidden',
    backgroundColor: color.vidrio,
    borderWidth: 1,
    borderColor: color.borde,
  },
  recienteFoto: { width: '100%', aspectRatio: 1, backgroundColor: color.vidrioAlto },
  recienteTacho: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 5,
    paddingTop: 7,
    borderRadius: 12,
    backgroundColor: color.velo,
  },
  recienteTextos: { padding: 10, gap: 0 },
  recienteMaterial: { fontFamily: 'SpaceGrotesk_600SemiBold' },
  vacio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radio.m,
    borderCurve: esquina,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.bordeFuerte,
  },
  detalle: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
  detalleCabecera: { flexDirection: 'row', alignItems: 'flex-end', gap: 18 },
  detalleTextos: { flex: 1, gap: 4, paddingBottom: 10 },
  detalleBloque: {
    gap: 8,
    padding: 16,
    borderRadius: radio.m,
    borderCurve: esquina,
    backgroundColor: color.vidrio,
    borderWidth: 1,
  },
  detalleFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detalleAviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radio.s,
    borderCurve: esquina,
    backgroundColor: color.errorTenue,
  },
});
