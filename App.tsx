import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { BACKEND_URL, getBackendHealth } from './src/api/courseBackend';
import { IncidentClient } from './src/api/incident-client';
import {
  CreateIncidentUseCase,
  GetIncidentDetailUseCase,
  GetIncidentsUseCase,
} from './src/application/incident-usecases';
import { SessionManager, type SessionIdentity } from './src/auth/session-manager';
import { secureStoreDriver } from './src/auth/session-storage';
import { describeApiError } from './src/domain/result';
import { IncidentListAndDetailScreen, LoginScreen } from './src/ui/IncidentScreens';

/** Composition root: the only place that wires HTTP and secure storage adapters to the use cases. */
function createServices() {
  const session = new SessionManager({ baseUrl: BACKEND_URL, storage: secureStoreDriver });
  const client = new IncidentClient({ baseUrl: BACKEND_URL, session });
  return {
    session,
    getIncidents: new GetIncidentsUseCase(client),
    getIncidentDetail: new GetIncidentDetailUseCase(client),
    createIncident: new CreateIncidentUseCase(client),
  };
}

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  const services = useMemo(() => createServices(), []);
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => active && setStatus('available'))
      .catch(() => active && setStatus('offline'));
    // Restore a persisted session after restarting the app; a failure means "anonymous".
    services.session
      .restore()
      .then((restored) => active && setIdentity(restored))
      .catch(() => active && setIdentity(null));
    return () => {
      active = false;
    };
  }, [services]);

  const login = async (actorId: string) => {
    const result = await services.session.login(actorId);
    if (result.ok) {
      setLoginError(null);
      setIdentity(result.value);
    } else setLoginError(describeApiError(result.error));
  };

  const logout = useCallback(async () => {
    await services.session.logout();
    setIdentity(null);
  }, [services]);

  const onUnauthorized = useCallback(() => {
    setIdentity(services.session.identity());
  }, [services]);

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>
        {identity ? (
          <View style={styles.row}>
            <Text testID="session-identity">
              Sesión: {identity.actorId} ({identity.role})
            </Text>
            <Text accessibilityRole="button" style={styles.link} onPress={() => void logout()}>
              Cerrar sesión
            </Text>
          </View>
        ) : null}
      </View>
      {identity ? (
        <IncidentListAndDetailScreen
          key={identity.actorId}
          identity={identity}
          getIncidentsUseCase={services.getIncidents}
          getIncidentDetailUseCase={services.getIncidentDetail}
          createIncidentUseCase={services.createIncident}
          onUnauthorized={onUnauthorized}
        />
      ) : (
        <LoginScreen onLogin={(actorId) => void login(actorId)} error={loginError} />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 48 },
  card: { gap: 12, padding: 20 },
  title: { fontSize: 24, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: '#007bff' },
});
