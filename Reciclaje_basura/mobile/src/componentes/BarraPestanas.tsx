import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, esquina, Icono, radio, sombra, Texto, type NombreIcono } from '../diseno';
import { useServidorCtx } from '../ServidorContext';

const PESTANAS: Record<string, { titulo: string; activo: NombreIcono; inactivo: NombreIcono }> = {
  Inicio: { titulo: 'Tachos', activo: 'grid', inactivo: 'grid-outline' },
  Historial: { titulo: 'Historial', activo: 'time', inactivo: 'time-outline' },
};

/**
 * Barra flotante: una píldora de vidrio con las dos pestañas y, en medio, el
 * botón de escanear que sobresale. Escanear abre la cámara a pantalla completa
 * por encima de las pestañas.
 */
export function BarraPestanas({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { estado, comprobar } = useServidorCtx();
  const caido = estado === 'caido';

  function escanear() {
    if (caido) {
      // Sin servidor la cámara no sirve: se avisa y se vuelve a buscar.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      comprobar();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    navigation.navigate('Camara');
  }

  const pestana = (indice: number) => {
    const ruta = state.routes[indice];
    const info = PESTANAS[ruta.name];
    const activa = state.index === indice;
    return (
      <Pressable
        key={ruta.key}
        onPress={() => {
          const evento = navigation.emit({ type: 'tabPress', target: ruta.key, canPreventDefault: true });
          if (!activa && !evento.defaultPrevented) {
            Haptics.selectionAsync().catch(() => {});
            navigation.navigate(ruta.name);
          }
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: activa }}
        accessibilityLabel={info.titulo}
        style={estilos.pestana}
      >
        <Icono nombre={activa ? info.activo : info.inactivo} tamano={22} tono={activa ? color.neon : color.textoSuave} />
        <Texto nivel="pequeno" tono={activa ? color.neon : color.textoSuave} style={estilos.titulo}>
          {info.titulo}
        </Texto>
        <View style={[estilos.marca, activa && estilos.marcaActiva]} />
      </Pressable>
    );
  };

  return (
    <View pointerEvents="box-none" style={[estilos.contenedor, { paddingBottom: insets.bottom + 12 }]}>
      <View style={estilos.barra}>
        {pestana(0)}
        <View style={estilos.hueco} />
        {pestana(1)}

        <Pressable
          onPress={escanear}
          accessibilityRole="button"
          accessibilityLabel={caido ? 'Sin servidor. Toca para volver a buscarlo.' : 'Escanear un residuo'}
          style={({ pressed }) => [
            estilos.escanear,
            caido ? estilos.escanearCaido : sombra.neon,
            pressed && estilos.pulsado,
          ]}
        >
          <Icono nombre={caido ? 'cloud-offline-outline' : 'scan'} tamano={30} tono={caido ? color.textoSuave : color.sobreNeon} />
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '84%',
    maxWidth: 380,
    height: 70,
    borderRadius: radio.pildora,
    borderCurve: esquina,
    backgroundColor: 'rgba(16,20,28,0.94)',
    borderWidth: 1,
    borderColor: color.bordeFuerte,
    boxShadow: '0 14px 36px rgba(0,0,0,0.65)',
  },
  pestana: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: '100%' },
  titulo: { fontSize: 11, lineHeight: 14 },
  marca: { width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: 'transparent' },
  marcaActiva: { backgroundColor: color.neon, boxShadow: `0 0 6px ${color.neon}` },
  hueco: { width: 84 },
  escanear: {
    position: 'absolute',
    left: '50%',
    marginLeft: -38,
    top: -26,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: color.neon,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: color.fondo,
  },
  escanearCaido: { backgroundColor: '#2A303B' },
  pulsado: { transform: [{ scale: 0.92 }] },
});
