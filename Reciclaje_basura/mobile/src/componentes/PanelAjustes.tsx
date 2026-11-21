import { useEffect, useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ApiError, obtenerSalud } from '../api';
import {
  Boton,
  BotonTexto,
  Chip,
  color,
  esquina,
  fuentes,
  Icono,
  radio,
  Tarjeta,
  Texto,
  type NombreIcono,
} from '../diseno';
import { useHistorialCtx } from '../historial';
import { useServidorCtx } from '../ServidorContext';
import { PUERTOS } from '../useServidor';

/**
 * Ajustes del servidor y del historial. Vive dentro de una hoja deslizable
 * que se abre desde el engranaje del inicio.
 */
export function PanelAjustes({ onCerrar }: { onCerrar: () => void }) {
  const { servidor, esAutomatico, guardar, restaurarAutomatico, comprobar, salud } =
    useServidorCtx();
  const { entradas, limpiar } = useHistorialCtx();

  const [valor, setValor] = useState(servidor);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enfocado, setEnfocado] = useState(false);

  // Si la dirección detectada cambia (otra red, otro arranque de Expo), el
  // campo tiene que seguirla mientras el usuario no haya fijado una propia.
  useEffect(() => {
    if (esAutomatico) setValor(servidor);
  }, [servidor, esAutomatico]);

  async function probar() {
    setProbando(true);
    setResultado(null);
    try {
      const s = await obtenerSalud(valor);
      if (s.estado === 'ok' && s.modelo) {
        setOk(true);
        setResultado(
          `Conectado. Modelo ${s.modelo.arch} en ${s.modelo.device}, ` +
            `${s.modelo.clases.length} materiales.`,
        );
      } else {
        setOk(false);
        setResultado(
          s.detalle ?? 'El servidor responde pero no tiene el modelo exportado todavía.',
        );
      }
    } catch (err) {
      setOk(false);
      if (err instanceof ApiError) {
        // La causa técnica importa aquí: distingue "no hay ruta hasta la
        // laptop" de "el servidor contestó un error".
        setResultado(err.causa ? `${err.message}\n${err.causa}` : err.message);
      } else {
        setResultado('Error desconocido.');
      }
    } finally {
      setProbando(false);
    }
  }

  function confirmarLimpieza() {
    Alert.alert(
      'Borrar el historial',
      `Se eliminarán ${entradas.length} escaneos guardados en este teléfono.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => void limpiar() },
      ],
    );
  }

  return (
    <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Seccion icono="server-outline" titulo="Servidor">
          <Tarjeta style={styles.tarjeta}>
            <View style={styles.modo}>
              <Chip
                texto={esAutomatico ? 'Detección automática' : 'Dirección fija'}
                punto={esAutomatico ? color.neon : color.cian}
              />
            </View>
            <Texto nivel="pequeno" tono={color.textoSuave}>
              {esAutomatico
                ? `Detectada a partir de la IP desde la que Expo sirve la app, probando los puertos ${PUERTOS.join(', ')}. Si editas y guardas, se queda fija esa dirección.`
                : 'Dirección fija. Tiene que ser la IP de la laptop en la red Wi-Fi, no localhost.'}
            </Texto>

            <View style={[styles.campo, enfocado && styles.campoEnfocado]}>
              <Icono nombre="link-outline" tamano={18} tono={enfocado ? color.neon : color.textoTenue} />
              <TextInput
                value={valor}
                onChangeText={setValor}
                onFocus={() => setEnfocado(true)}
                onBlur={() => setEnfocado(false)}
                placeholder="http://192.168.1.100:8000"
                placeholderTextColor={color.textoTenue}
                selectionColor={color.neon}
                cursorColor={color.neon}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
              />
            </View>

            <View style={styles.botones}>
              <Boton
                titulo="Probar"
                variante="vidrio"
                icono="pulse"
                cargando={probando}
                onPress={probar}
                style={styles.flex}
              />
              <Boton
                titulo="Guardar"
                icono="checkmark"
                onPress={() => {
                  guardar(valor);
                  comprobar();
                  onCerrar();
                }}
                style={styles.flex}
              />
            </View>

            {esAutomatico ? null : (
              <BotonTexto
                titulo="Volver a la detección automática"
                icono="refresh"
                onPress={() => {
                  restaurarAutomatico();
                  setResultado(null);
                }}
              />
            )}

            {resultado ? (
              <View style={[styles.resultado, ok ? styles.resOk : styles.resError]}>
                <Icono
                  nombre={ok ? 'checkmark-circle' : 'close-circle'}
                  tamano={18}
                  tono={ok ? color.neon : color.error}
                />
                <Texto nivel="pequeno" tono={ok ? '#E6FBB0' : '#FFD6DE'} style={styles.flex}>
                  {resultado}
                </Texto>
              </View>
            ) : null}
          </Tarjeta>
        </Seccion>

        {salud?.modelo ? (
          <Seccion icono="hardware-chip-outline" titulo="Modelo en uso">
            <Tarjeta style={styles.ficha}>
              <Dato icono="git-network-outline" clave="Arquitectura" valor={salud.modelo.arch} />
              <Dato icono="speedometer-outline" clave="Ejecuta en" valor={salud.modelo.device} />
              <Dato icono="layers-outline" clave="Materiales" valor={String(salud.modelo.clases.length)} />
              <Dato icono="image-outline" clave="Límite de foto" valor={`${salud.max_mb} MB`} ultimo />
            </Tarjeta>
          </Seccion>
        ) : null}

        <Seccion icono="time-outline" titulo="Historial">
          <Tarjeta style={styles.tarjeta}>
            <View style={styles.historial}>
              <Texto nivel="display" style={styles.numero}>
                {entradas.length}
              </Texto>
              <Texto nivel="pequeno" tono={color.textoSuave} style={styles.flex}>
                {entradas.length === 0
                  ? 'Todavía no hay escaneos guardados.'
                  : 'escaneos guardados en este teléfono.'}
              </Texto>
            </View>
            <Boton
              titulo="Borrar historial"
              variante="peligro"
              icono="trash-outline"
              onPress={confirmarLimpieza}
              deshabilitado={entradas.length === 0}
            />
          </Tarjeta>
        </Seccion>
    </ScrollView>
  );
}

function Seccion({
  icono,
  titulo,
  children,
}: {
  icono: NombreIcono;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.seccion}>
      <View style={styles.seccionCabecera}>
        <Icono nombre={icono} tamano={15} tono={color.neon} />
        <Texto nivel="etiqueta" tono={color.textoSuave}>
          {titulo}
        </Texto>
      </View>
      {children}
    </View>
  );
}

function Dato({
  icono,
  clave,
  valor,
  ultimo,
}: {
  icono: NombreIcono;
  clave: string;
  valor: string;
  ultimo?: boolean;
}) {
  return (
    <View style={[styles.dato, !ultimo && styles.datoSeparado]}>
      <Icono nombre={icono} tamano={18} tono={color.textoSuave} />
      <Texto nivel="cuerpo" tono={color.textoSuave} style={styles.flex}>
        {clave}
      </Texto>
      <Texto nivel="cuerpoFuerte">{valor}</Texto>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 22 },
  seccion: { gap: 10 },
  seccionCabecera: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  tarjeta: { gap: 14 },
  modo: { flexDirection: 'row' },
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderColor: color.bordeFuerte,
    borderWidth: 1,
    borderRadius: radio.m,
    borderCurve: esquina,
  },
  campoEnfocado: { borderColor: color.neon, boxShadow: '0 0 14px rgba(198,244,50,0.3)' },
  input: {
    flex: 1,
    color: color.texto,
    fontFamily: fuentes.medio,
    fontSize: 15,
    paddingVertical: 14,
  },
  botones: { flexDirection: 'row', gap: 10 },
  resultado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: radio.s,
    borderCurve: esquina,
  },
  resOk: { backgroundColor: color.neonTenue },
  resError: { backgroundColor: color.errorTenue },
  ficha: { paddingVertical: 4 },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  datoSeparado: { borderBottomWidth: 1, borderBottomColor: color.borde },
  historial: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  numero: { fontSize: 44, lineHeight: 48 },
});
