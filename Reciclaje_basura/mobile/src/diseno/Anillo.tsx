import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { color } from './tokens';

type Props = {
  /** De 0 a 1. */
  valor: number;
  tamano?: number;
  grosor?: number;
  tono?: string;
  pista?: string;
  children?: ReactNode;
};

/** Anillo de progreso, para la confianza del modelo. */
function AnilloBase({
  valor,
  tamano = 64,
  grosor = 6,
  tono = color.neon,
  pista = 'rgba(255,255,255,0.1)',
  children,
}: Props) {
  const r = (tamano - grosor) / 2;
  const circunferencia = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, valor));
  const centro = tamano / 2;

  return (
    <View style={{ width: tamano, height: tamano, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={tamano} height={tamano} style={StyleSheet.absoluteFill}>
        <Circle cx={centro} cy={centro} r={r} stroke={pista} strokeWidth={grosor} fill="none" />
        <Circle
          cx={centro}
          cy={centro}
          r={r}
          stroke={tono}
          strokeWidth={grosor}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circunferencia} ${circunferencia}`}
          strokeDashoffset={circunferencia * (1 - v)}
          transform={`rotate(-90 ${centro} ${centro})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export const Anillo = memo(AnilloBase);
