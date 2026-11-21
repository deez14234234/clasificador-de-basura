import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Texto } from './Texto';
import { color, esquina } from './tokens';

type Props = {
  visible: boolean;
  onCerrar: () => void;
  titulo?: string;
  children: ReactNode;
};

/**
 * Hoja que sube desde abajo. Se cierra tocando fuera, con el botón atrás o
 * arrastrando el asa hacia abajo.
 *
 * El arrastre sólo se engancha en el asa y el título, para que un ScrollView
 * dentro de la hoja siga desplazándose con normalidad.
 */
export function Hoja({ visible, onCerrar, titulo, children }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(height)).current;
  const [montada, setMontada] = useState(visible);

  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;

  useEffect(() => {
    if (visible) {
      setMontada(true);
      y.setValue(height);
      Animated.spring(y, { toValue: 0, friction: 10, tension: 70, useNativeDriver: true }).start();
    } else {
      Animated.timing(y, {
        toValue: height,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => setMontada(false));
    }
  }, [visible, height, y]);

  const arrastre = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 110 || g.vy > 0.9) cerrar.current();
          else Animated.spring(y, { toValue: 0, friction: 8, useNativeDriver: true }).start();
        },
      }),
    [y],
  );

  if (!montada) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onCerrar}>
      <KeyboardAvoidingView
        style={estilos.raiz}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            estilos.velo,
            {
              opacity: y.interpolate({
                inputRange: [0, height],
                outputRange: [1, 0],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          <Pressable style={estilos.raiz} onPress={onCerrar} accessibilityLabel="Cerrar" />
        </Animated.View>

        <Animated.View
          style={[
            estilos.hoja,
            { maxHeight: height * 0.9, paddingBottom: insets.bottom + 16, transform: [{ translateY: y }] },
          ]}
        >
          <View {...arrastre.panHandlers} style={estilos.agarre}>
            <View style={estilos.asa} />
            {titulo ? (
              <Texto nivel="subtitulo" centrado>
                {titulo}
              </Texto>
            ) : null}
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, justifyContent: 'flex-end' },
  velo: { backgroundColor: 'rgba(0,0,0,0.62)' },
  hoja: {
    backgroundColor: '#0E1219',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderCurve: esquina,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: color.bordeFuerte,
    boxShadow: '0 -12px 40px rgba(0,0,0,0.6)',
  },
  agarre: { alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 8 },
  asa: { width: 44, height: 5, borderRadius: 3, backgroundColor: color.bordeFuerte },
});
