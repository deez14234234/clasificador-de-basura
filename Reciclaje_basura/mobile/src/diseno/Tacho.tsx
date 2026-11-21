import { memo, useEffect, useId, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { tonoVisible } from './tokens';

type Props = {
  /** Color del tacho según la NTP. */
  hex: string;
  /** Color de los detalles (nervaduras), legible sobre `hex`. */
  textoHex?: string;
  ancho?: number;
  /** Abre la tapa con un resorte. */
  abierta?: boolean;
  /** Halo de color en el suelo, bajo el tacho. */
  brillo?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Proporción alto / ancho del dibujo (viewBox 100 × 130). */
const PROPORCION = 1.3;
/** Alto de la tapa en unidades del viewBox. */
const ALTO_TAPA = 32;

const CUERPO = 'M13 34 H87 L81 116 Q80 122 74 122 H26 Q20 122 19 116 Z';

/**
 * Silueta de un tacho de basura con tapa, cuerpo con nervaduras y ruedas.
 *
 * La tapa es un SVG aparte dentro de una vista animada que gira sobre su
 * bisagra izquierda: así la animación corre en el hilo nativo sin tener que
 * animar atributos SVG.
 */
function TachoBase({
  hex,
  textoHex = '#FFFFFF',
  ancho = 80,
  abierta = false,
  brillo = true,
  style,
}: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const giro = useRef(new Animated.Value(abierta ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(giro, {
      toValue: abierta ? 1 : 0,
      friction: 5,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [abierta, giro]);

  const alto = ancho * PROPORCION;
  const altoTapa = (ancho * ALTO_TAPA) / 100;
  const tono = tonoVisible(hex);
  // El tacho negro necesita un contorno más visible sobre el fondo oscuro.
  const contorno = tono === hex ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.6)';

  return (
    <View style={[{ width: ancho, height: alto }, style]}>
      <Svg width={ancho} height={alto} viewBox="0 0 100 130" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`v${id}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.24} />
            <Stop offset="0.38" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        {brillo ? <Ellipse cx={50} cy={126} rx={40} ry={4} fill={tono} opacity={0.4} /> : null}
        <Path d={CUERPO} fill={hex} stroke={contorno} strokeWidth={1.2} />
        <Path d={CUERPO} fill={`url(#v${id})`} />
        <Rect x={13} y={34} width={74} height={6} fill="#000000" opacity={0.22} />
        {[
          [34, 36.5],
          [50, 50],
          [66, 63.5],
        ].map(([x1, x2]) => (
          <Line
            key={x1}
            x1={x1}
            y1={50}
            x2={x2}
            y2={108}
            stroke={textoHex}
            strokeOpacity={0.28}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
        ))}
        <Circle cx={28} cy={123} r={4} fill="#0B0D12" stroke={contorno} strokeWidth={1} />
        <Circle cx={72} cy={123} r={4} fill="#0B0D12" stroke={contorno} strokeWidth={1} />
      </Svg>

      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: ancho,
          height: altoTapa,
          transformOrigin: [ancho * 0.1, altoTapa, 0],
          transform: [
            { rotate: giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-34deg'] }) },
          ],
        }}
      >
        <Svg width={ancho} height={altoTapa} viewBox={`0 0 100 ${ALTO_TAPA}`}>
          <Defs>
            <LinearGradient id={`t${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.3} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path
            d="M38 22 V16 Q38 9 45 9 H55 Q62 9 62 16 V22"
            stroke={hex}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M38 22 V16 Q38 9 45 9 H55 Q62 9 62 16 V22"
            stroke={contorno}
            strokeWidth={1}
            fill="none"
          />
          <Rect x={8} y={19} width={84} height={13} rx={5} fill={hex} stroke={contorno} strokeWidth={1.2} />
          <Rect x={8} y={19} width={84} height={13} rx={5} fill={`url(#t${id})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

export const Tacho = memo(TachoBase);
