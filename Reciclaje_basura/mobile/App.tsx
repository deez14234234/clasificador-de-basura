import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';

import { BarraPestanas } from './src/componentes/BarraPestanas';
import { color, Fondo } from './src/diseno';
import { Camara } from './src/pantallas/Camara';
import { Historial } from './src/pantallas/Historial';
import { Inicio } from './src/pantallas/Inicio';
import { Resultado } from './src/pantallas/Resultado';
import { ProveedorHistorial } from './src/historial';
import type { Pestanas, Rutas } from './src/rutas';
import { ProveedorServidor, useServidorCtx } from './src/ServidorContext';

const Stack = createNativeStackNavigator<Rutas>();
const Tabs = createBottomTabNavigator<Pestanas>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: color.fondo,
    card: color.fondo,
    text: color.texto,
    border: color.borde,
    primary: color.neon,
  },
};

function Cargando() {
  return (
    <View style={styles.cargando}>
      <Fondo />
      <ActivityIndicator color={color.neon} size="large" />
    </View>
  );
}

/** Las dos pestañas, con la barra flotante propia. */
function Principal() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <BarraPestanas {...props} />}
      screenOptions={{
        headerShown: false,
        animation: 'shift',
        sceneStyle: { backgroundColor: color.fondo },
      }}
    >
      <Tabs.Screen name="Inicio" component={Inicio} />
      <Tabs.Screen name="Historial" component={Historial} />
    </Tabs.Navigator>
  );
}

function Navegacion() {
  const { cargado } = useServidorCtx();

  // Hasta que no se lee la dirección guardada no se sabe a qué servidor
  // apuntar, y arrancar antes haría que la pantalla de inicio comprobara una
  // dirección que está por cambiar.
  if (!cargado) return <Cargando />;

  // Stack nativo (UINavigationController / Fragment) en vez de uno en JS: trae
  // gratis el gesto de volver, el botón físico de Android y las transiciones
  // propias de la plataforma. La cámara y el resultado van por encima de las
  // pestañas, a pantalla completa.
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.fondo } }}
    >
      <Stack.Screen name="Principal" component={Principal} />
      <Stack.Screen name="Camara" component={Camara} options={{ animation: 'fade' }} />
      <Stack.Screen
        name="Resultado"
        component={Resultado}
        options={{ animation: 'fade', gestureDirection: 'vertical' }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  // Si la fuente falla (sin red la primera vez) se sigue con la del sistema:
  // la app tiene que funcionar igual.
  const [fuentesListas, errorFuentes] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {fuentesListas || errorFuentes ? (
        <ProveedorServidor>
          <ProveedorHistorial>
            <NavigationContainer theme={navTheme}>
              <Navegacion />
            </NavigationContainer>
          </ProveedorHistorial>
        </ProveedorServidor>
      ) : (
        <Cargando />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  cargando: {
    flex: 1,
    backgroundColor: color.fondo,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
