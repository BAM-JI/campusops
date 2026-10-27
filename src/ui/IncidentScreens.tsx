import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  createIdempotencyKey,
  type CreateIncidentUseCase,
  type GetIncidentDetailUseCase,
  type GetIncidentsUseCase,
} from '../application/incident-usecases';
import type { Incident } from '../domain/incident';
import { describeApiError, type ApiError } from '../domain/result';
import type { CampusRole } from '../campusops/contracts';

type Identity = Readonly<{ actorId: string; role: CampusRole }>;

type ListState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; items: readonly Incident[] }>
  | Readonly<{ kind: 'error'; error: ApiError }>;

interface Props {
  identity: Identity;
  getIncidentsUseCase: GetIncidentsUseCase;
  getIncidentDetailUseCase: GetIncidentDetailUseCase;
  createIncidentUseCase: CreateIncidentUseCase;
  onUnauthorized: () => void;
}

/** Screens only talk to use cases; no fetch, no tokens, no DTOs here. */
export function IncidentListAndDetailScreen({
  identity,
  getIncidentsUseCase,
  getIncidentDetailUseCase,
  createIncidentUseCase,
  onUnauthorized,
}: Props) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Incident | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleError = useCallback(
    (error: ApiError) => {
      if (error.kind === 'unauthorized') onUnauthorized();
      setMessage(describeApiError(error));
    },
    [onUnauthorized],
  );

  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    void getIncidentsUseCase.execute().then((result) => {
      if (!active) return;
      if (result.ok) setList({ kind: 'ready', items: result.value });
      else {
        setList({ kind: 'error', error: result.error });
        handleError(result.error);
      }
    });
    return () => {
      active = false;
    };
  }, [getIncidentsUseCase, handleError, reloadCount]);

  const reload = () => setReloadCount((count) => count + 1);

  const handleSelect = async (id: string) => {
    const result = await getIncidentDetailUseCase.execute(id);
    if (result.ok) setSelected(result.value);
    else handleError(result.error);
  };

  if (selected) {
    return (
      <View style={styles.detailCard}>
        <Text style={styles.title}>Incidencia {selected.id}</Text>
        <Text>Estado: {selected.status}</Text>
        <Text>Categoría: {selected.category}</Text>
        <Text>Prioridad: {selected.priority}</Text>
        <Text>Ubicación: {selected.location}</Text>
        <Text>Descripción: {selected.description}</Text>
        <Text>Versión: {selected.version}</Text>
        <TouchableOpacity style={styles.button} onPress={() => setSelected(null)}>
          <Text style={styles.buttonText}>Regresar a la lista</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Incidencias visibles para {identity.role}</Text>
      {message ? <Text testID="incident-message">{message}</Text> : null}
      {list.kind === 'loading' ? <Text>Cargando…</Text> : null}
      {list.kind === 'ready' && list.items.length === 0 ? <Text>No hay incidencias visibles.</Text> : null}
      {list.kind === 'ready' ? (
        <FlatList
          data={list.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => void handleSelect(item.id)}>
              <Text style={styles.itemTitle}>
                {item.id} · {item.category}
              </Text>
              <Text>Estado: {item.status}</Text>
            </TouchableOpacity>
          )}
        />
      ) : null}
      {identity.role === 'reporter' ? (
        <CreateIncidentForm
          role={identity.role}
          useCase={createIncidentUseCase}
          onCreated={reload}
          onError={handleError}
        />
      ) : null}
    </View>
  );
}

function CreateIncidentForm({
  role,
  useCase,
  onCreated,
  onError,
}: Readonly<{
  role: CampusRole;
  useCase: CreateIncidentUseCase;
  onCreated: () => void;
  onError: (error: ApiError) => void;
}>) {
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  // The same key is reused while the draft does not change, so a retry after a timeout does not duplicate.
  const draftKey = useRef(createIdempotencyKey());

  const submit = async () => {
    const result = await useCase.execute(role, { category: 'connectivity', description, location }, draftKey.current);
    if (result.ok) {
      draftKey.current = createIdempotencyKey();
      setDescription('');
      setLocation('');
      onCreated();
    } else onError(result.error);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.itemTitle}>Reportar incidencia de conectividad</Text>
      <TextInput
        style={styles.input}
        placeholder="Descripción"
        value={description}
        onChangeText={(text) => {
          draftKey.current = createIdempotencyKey();
          setDescription(text);
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="Ubicación (texto)"
        value={location}
        onChangeText={(text) => {
          draftKey.current = createIdempotencyKey();
          setLocation(text);
        }}
      />
      <TouchableOpacity style={styles.button} onPress={() => void submit()}>
        <Text style={styles.buttonText}>Enviar</Text>
      </TouchableOpacity>
    </View>
  );
}

export const FIXTURE_ACTORS: readonly string[] = ['reporter-1', 'technician-1', 'technician-2', 'coordinator-1'];

/** Selector of public fixture actors: a teaching aid, not production authentication. */
export function LoginScreen({ onLogin, error }: Readonly<{ onLogin: (actorId: string) => void; error: string | null }>) {
  return (
    <View style={styles.form}>
      <Text style={styles.itemTitle}>Iniciar sesión (actores ficticios del curso)</Text>
      {error ? <Text testID="login-error">{error}</Text> : null}
      {/* Plain Text buttons keep the first (anonymous) screen light to render. */}
      {FIXTURE_ACTORS.map((actorId) => (
        <Text
          key={actorId}
          accessibilityRole="button"
          style={[styles.button, styles.buttonText]}
          onPress={() => onLogin(actorId)}
        >
          {actorId}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 8 },
  header: { fontSize: 18, fontWeight: 'bold' },
  card: { padding: 14, backgroundColor: '#fff', borderRadius: 8, marginBottom: 8 },
  detailCard: { gap: 6, padding: 16, backgroundColor: '#fff', borderRadius: 8 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  form: { gap: 8, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  button: { padding: 10, backgroundColor: '#007bff', borderRadius: 6 },
  buttonText: { color: '#fff', textAlign: 'center' },
});
