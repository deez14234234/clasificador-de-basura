import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ALTO_BARRA,
  Aparecer,
  Boton,
  color,
  esquina,
  Pantalla,
  radio,
  Tacho,
  Texto,
  tonoVisible,
} from '../diseno';
import { useHistorialCtx, type Entrada } from '../historial';
import type { PropsPestana } from '../rutas';
import { COLORES_NTP, cuando, porcentaje } from '../theme';

/**
 * Historial de escaneos: arriba, cuántos fueron a cada tacho; debajo, la
 * cuadrícula de fotos. Se borra desde Ajustes.
 */
export function Historial({ navigation }: PropsPestana<'Historial'>) {
  const { entradas } = useHistorialCtx();
  const insets = useSafeAreaInsets();

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entradas) c[e.color] = (c[e.color] ?? 0) + 1;
    return c;
  }, [entradas]);

  const maximo = Math.max(1, ...Object.values(conteo));

  return (
    <Pantalla acento={color.cian} secundario={color.violeta} intensidad={0.8}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + ALTO_BARRA + 16 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Aparecer style={styles.cabecera}>
          <Texto nivel="etiqueta" tono={color.cian}>
            Tu actividad
          </Texto>
          <View style={styles.titulo}>
            <Texto nivel="display">Historial</Texto>
            <Texto nivel="titulo" tono={color.textoTenue}>
              {entradas.length}
            </Texto>
          </View>
        </Aparecer>

        <Aparecer retraso={80} style={styles.resumen}>
          {COLORES_NTP.map((c) => {
            const n = conteo[c.key] ?? 0;
            return (
              <View key={c.key} style={styles.columna}>
                <Texto nivel="dato" tono={n ? tonoVisible(c.hex) : color.textoTenue} style={styles.cuenta}>
                  {n}
                </Texto>
                <View style={styles.pista}>
                  <View
                    style={[
                      styles.relleno,
                      {
                        height: `${(n / maximo) * 100}%`,
                        backgroundColor: tonoVisible(c.hex),
                        boxShadow: n ? `0 0 10px ${tonoVisible(c.hex)}88` : undefined,
                      },
                    ]}
                  />
                </View>
                <View style={{ opacity: n ? 1 : 0.35 }}>
                  <Tacho hex={c.hex} textoHex={c.textoHex} ancho={30} brillo={false} />
                </View>
              </View>
            );
          })}
        </Aparecer>

        {entradas.length === 0 ? (
          <Aparecer retraso={160} style={styles.vacio}>
            <Tacho hex="#3A414D" ancho={96} abierta />
            <Texto nivel="subtitulo" centrado>
              Aún no hay escaneos
            </Texto>
            <Texto nivel="cuerpo" tono={color.textoSuave} centrado>
              Cada foto que analices queda guardada aquí, en este teléfono.
            </Texto>
            <Boton titulo="Escanear ahora" icono="scan" onPress={() => navigation.navigate('Camara')} />
          </Aparecer>
        ) : (
          <View style={styles.rejilla}>
            {entradas.map((e, i) => (
              <Aparecer key={e.id} retraso={120 + Math.min(i, 8) * 50} style={styles.celda}>
                <Tarjeta entrada={e} />
              </Aparecer>
            ))}
          </View>
        )}
      </ScrollView>
    </Pantalla>
  );
}

function Tarjeta({ entrada }: { entrada: Entrada }) {
  const tono = tonoVisible(entrada.hex);
  return (
    <View style={[styles.tarjeta, { borderColor: `${tono}40` }]}>
      <Image source={{ uri: entrada.fotoUri }} style={styles.foto} contentFit="cover" transition={150} />
      <View style={styles.degradado} />
      <View style={styles.tachito}>
        <Tacho hex={entrada.hex} textoHex={entrada.textoHex} ancho={24} brillo={false} />
      </View>
      <View style={styles.pie}>
        <Texto nivel="cuerpoFuerte" numberOfLines={1}>
          {entrada.materialLabel}
        </Texto>
        <View style={styles.meta}>
          <Texto nivel="pequeno" tono={tono} style={styles.metaFuerte}>
            {entrada.colorNombre} · {porcentaje.format(entrada.confianza)}
          </Texto>
        </View>
        <Texto nivel="pequeno" tono={color.textoTenue} style={styles.cuando}>
          {cuando(entrada.ts)}
        </Texto>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, gap: 22 },
  cabecera: { gap: 4 },
  titulo: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  resumen: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: radio.l,
    borderCurve: esquina,
    backgroundColor: color.vidrio,
    borderWidth: 1,
    borderColor: color.borde,
  },
  columna: { alignItems: 'center', gap: 8 },
  cuenta: { fontSize: 14 },
  pista: {
    width: 8,
    height: 64,
    borderRadius: 4,
    backgroundColor: color.vidrioAlto,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  relleno: { width: '100%', borderRadius: 4 },
  vacio: { alignItems: 'center', gap: 12, paddingTop: 28, paddingHorizontal: 10 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  celda: { width: '48%' },
  tarjeta: {
    borderRadius: radio.l,
    borderCurve: esquina,
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: color.vidrio,
  },
  foto: { width: '100%', aspectRatio: 0.85, backgroundColor: color.vidrioAlto },
  degradado: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '70%',
    experimental_backgroundImage: 'linear-gradient(to bottom, rgba(7,9,13,0), rgba(7,9,13,0.95))',
  },
  tachito: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 6,
    paddingTop: 8,
    borderRadius: 14,
    backgroundColor: color.velo,
  },
  pie: { position: 'absolute', left: 12, right: 12, bottom: 12, gap: 1 },
  meta: { flexDirection: 'row' },
  metaFuerte: { fontFamily: 'SpaceGrotesk_600SemiBold' },
  cuando: { fontSize: 11 },
});
