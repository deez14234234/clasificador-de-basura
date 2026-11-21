import { memo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icono, type NombreIcono } from './Icono';
import { Texto } from './Texto';
import { color, esquina, radio, sombra, TACTIL_MINIMO } from './tokens';

export type VarianteBoton = 'neon' | 'vidrio' | 'contorno' | 'peligro';

type Props = {
  titulo: string;
  onPress: () => void;
  variante?: VarianteBoton;
  tamano?: 'normal' | 'grande';
  icono?: NombreIcono;
  cargando?: boolean;
  deshabilitado?: boolean;
  style?: StyleProp<ViewStyle>;
};

const TINTA: Record<VarianteBoton, string> = {
  neon: color.sobreNeon,
  vidrio: color.texto,
  contorno: color.neon,
  peligro: color.error,
};

/** Botón píldora. `neon` es la acción principal de cada pantalla, con brillo. */
function BotonBase({
  titulo,
  onPress,
  variante = 'neon',
  tamano = 'normal',
  icono,
  cargando = false,
  deshabilitado = false,
  style,
}: Props) {
  const inactivo = deshabilitado || cargando;
  const tinta = TINTA[variante];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      style={({ pressed }) => [
        estilos.base,
        tamano === 'grande' && estilos.grande,
        estilos[variante],
        variante === 'neon' && !inactivo && sombra.neon,
        pressed && estilos.pulsado,
        inactivo && estilos.inactivo,
        style,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={tinta} />
      ) : (
        <View style={estilos.contenido}>
          {icono ? <Icono nombre={icono} tamano={tamano === 'grande' ? 22 : 19} tono={tinta} /> : null}
          <Texto nivel="boton" tono={tinta} style={tamano === 'grande' && estilos.textoGrande}>
            {titulo}
          </Texto>
        </View>
      )}
    </Pressable>
  );
}

export const Boton = memo(BotonBase);

type PropsIcono = {
  icono: NombreIcono;
  etiqueta: string;
  onPress: () => void;
  activo?: boolean;
  tamano?: number;
  style?: StyleProp<ViewStyle>;
};

/** Botón redondo de vidrio, para barras superiores y controles sobre la cámara. */
function BotonIconoBase({ icono, etiqueta, onPress, activo = false, tamano = TACTIL_MINIMO, style }: PropsIcono) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ selected: activo }}
      style={({ pressed }) => [
        estilos.icono,
        { width: tamano, height: tamano, borderRadius: tamano / 2 },
        activo && estilos.iconoActivo,
        activo && sombra.neon,
        pressed && estilos.pulsado,
        style,
      ]}
    >
      <Icono nombre={icono} tamano={tamano * 0.44} tono={activo ? color.sobreNeon : color.texto} />
    </Pressable>
  );
}

export const BotonIcono = memo(BotonIconoBase);

type PropsTexto = { titulo: string; onPress: () => void; icono?: NombreIcono };

/** Enlace de texto en neón, para acciones secundarias. */
function BotonTextoBase({ titulo, onPress, icono }: PropsTexto) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      style={({ pressed }) => [estilos.enlace, pressed && estilos.pulsadoTexto]}
    >
      {icono ? <Icono nombre={icono} tamano={16} tono={color.neon} /> : null}
      <Texto nivel="cuerpoFuerte" tono={color.neon}>
        {titulo}
      </Texto>
    </Pressable>
  );
}

export const BotonTexto = memo(BotonTextoBase);

const estilos = StyleSheet.create({
  base: {
    minHeight: 54,
    paddingHorizontal: 22,
    borderRadius: radio.pildora,
    borderCurve: esquina,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grande: { minHeight: 64, paddingHorizontal: 26 },
  contenido: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  textoGrande: { fontSize: 18 },
  neon: { backgroundColor: color.neon },
  vidrio: { backgroundColor: color.vidrioAlto, borderWidth: 1, borderColor: color.bordeFuerte },
  contorno: { backgroundColor: color.neonTenue, borderWidth: 1.5, borderColor: color.neon },
  peligro: { backgroundColor: color.errorTenue, borderWidth: 1, borderColor: 'rgba(255,77,109,0.45)' },
  pulsado: { transform: [{ scale: 0.97 }], opacity: 0.85 },
  inactivo: { opacity: 0.4 },
  icono: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.velo,
    borderWidth: 1,
    borderColor: color.bordeFuerte,
  },
  iconoActivo: { backgroundColor: color.neon, borderColor: color.neon },
  enlace: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  pulsadoTexto: { opacity: 0.6 },
});
