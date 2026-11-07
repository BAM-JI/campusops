import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  createIdempotencyKey,
  type CreateIncidentUseCase,
  type GetIncidentDetailUseCase,
  type GetIncidentsUseCase,
} from '../application/incident-usecases';
import type { LocationNotice, ResolveIncidentLocationUseCase } from '../application/location-usecases';
import { IDLE_TRACKER, toViewState, trackRequests, type ViewState } from '../application/view-state';
import type { Incident } from '../domain/incident';
import { describeApiError, describeErrorKind, type ApiError } from '../domain/result';
import type { CampusRole } from '../campusops/contracts';

type Identity = Readonly<{ actorId: string; role: CampusRole }>;

const asIncidents = (value: unknown) => value as readonly Incident[];
const asIncident = (value: unknown) => value as Incident;
const isEmptyList = (items: readonly Incident[]) => items.length === 0;

let requestSequence = 0;
const nextRequestId = (prefix: string) => `${prefix}-${++requestSequence}`;

/**
 * Message, live-region text and recovery action for every non-success view state.
 * Loading always ends: the client has its own timeout and bounded retries, and the user can cancel.
 */
function StatusView({
  state,
  subject,
  onRetry,
  onCancel,
}: Readonly<{
  state: ViewState<unknown>;
  subject: string;
  onRetry: () => void;
  onCancel: () => void;
}>) {
  switch (state.kind) {
    case 'loading':
      return (
        <View accessibilityState={{ busy: true }} accessibilityLabel={`Cargando ${subject}`} style={styles.status}>
          <Text accessibilityLiveRegion="polite">Cargando {subject}…</Text>
          <StateButton label={`Cancelar carga de ${subject}`} text="Cancelar" onPress={onCancel} />
        </View>
      );
    case 'empty':
      return (
        <View style={styles.status}>
          <Text accessibilityLiveRegion="polite">No hay {subject} visibles para tu perfil.</Text>
          <StateButton label={`Actualizar ${subject}`} text="Actualizar" onPress={onRetry} />
        </View>
      );
    case 'offline':
      return (
        <View style={styles.status}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">
            Sin conexión con el servidor. Revisa tu red y vuelve a intentar.
          </Text>
          <StateButton label={`Reintentar cargar ${subject}`} text="Reintentar" onPress={onRetry} />
        </View>
      );
    case 'error':
      return (
        <View style={styles.status}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {describeErrorKind(state.error)}
          </Text>
          <StateButton label={`Reintentar cargar ${subject}`} text="Reintentar" onPress={onRetry} />
        </View>
      );
    case 'cancelled':
      return (
        <View style={styles.status}>
          <Text accessibilityLiveRegion="polite">Carga cancelada.</Text>
          <StateButton label={`Volver a cargar ${subject}`} text="Volver a cargar" onPress={onRetry} />
        </View>
      );
    default:
      return null;
  }
}

function StateButton({ label, text, onPress }: Readonly<{ label: string; text: string; onPress: () => void }>) {
  return (
    <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Text style={styles.buttonText}>{text}</Text>
    </TouchableOpacity>
  );
}

interface Props {
  identity: Identity;
  getIncidentsUseCase: GetIncidentsUseCase;
  getIncidentDetailUseCase: GetIncidentDetailUseCase;
  createIncidentUseCase: CreateIncidentUseCase;
  /** Week 09: optional location lookup; without it the location is only typed by hand. */
  resolveLocationUseCase?: ResolveIncidentLocationUseCase;
  onUnauthorized: () => void;
}

/** Screens only talk to use cases; no fetch, no tokens, no DTOs here. */
export function IncidentListAndDetailScreen({
  identity,
  getIncidentsUseCase,
  getIncidentDetailUseCase,
  createIncidentUseCase,
  resolveLocationUseCase,
  onUnauthorized,
}: Props) {
  const [message, setMessage] = useState<string | null>(null);

  const handleError = useCallback(
    (error: ApiError) => {
      if (error.kind === 'unauthorized') onUnauthorized();
      setMessage(describeApiError(error));
    },
    [onUnauthorized],
  );

  // List: every load is a new request; an older load that answers late never replaces the newest one.
  const [listTracker, dispatchList] = useReducer(trackRequests, IDLE_TRACKER);
  const loadList = useCallback(() => {
    const requestId = nextRequestId('list');
    dispatchList({ type: 'request', requestId });
    void getIncidentsUseCase.execute().then((result) => {
      dispatchList({ type: 'response', response: result.ok ? { requestId, value: result.value } : { requestId, error: result.error.kind } });
      if (!result.ok && result.error.kind === 'unauthorized') onUnauthorized();
    });
  }, [getIncidentsUseCase, onUnauthorized]);

  // First load once the screen is shown (the request event and the answer arrive asynchronously).
  useEffect(() => {
    const timer = setTimeout(loadList, 0);
    return () => clearTimeout(timer);
  }, [loadList]);

  // Detail: the selected incident is the active request; answers of previous selections are ignored.
  const [detailTracker, dispatchDetail] = useReducer(trackRequests, IDLE_TRACKER);
  const lastSelection = useRef<string | null>(null);
  const handleSelect = (id: string) => {
    lastSelection.current = id;
    const requestId = nextRequestId(`detail-${id}`);
    dispatchDetail({ type: 'request', requestId });
    void getIncidentDetailUseCase.execute(id).then((result) => {
      dispatchDetail({ type: 'response', response: result.ok ? { requestId, value: result.value } : { requestId, error: result.error.kind } });
      if (!result.ok && result.error.kind === 'unauthorized') onUnauthorized();
    });
  };

  // Before the first request starts (one tick) the list is already shown as loading, never blank.
  const rawListView = toViewState(listTracker, asIncidents, isEmptyList);
  const listView: ViewState<readonly Incident[]> = rawListView.kind === 'idle' ? { kind: 'loading' } : rawListView;
  const detailView = toViewState(detailTracker, asIncident);

  if (detailView.kind !== 'idle') {
    return (
      <View style={styles.detailCard}>
        {detailView.kind === 'success' ? (
          <View accessibilityLabel={`Detalle de la incidencia ${detailView.value.id}`}>
            <Text style={styles.title} accessibilityRole="header" testID="detail-title">
              Incidencia {detailView.value.id}
            </Text>
            <Text>Estado: {detailView.value.status}</Text>
            <Text>Categoría: {detailView.value.category}</Text>
            <Text>Prioridad: {detailView.value.priority}</Text>
            <Text>Ubicación: {detailView.value.location}</Text>
            <Text>Descripción: {detailView.value.description}</Text>
            <Text>Versión: {detailView.value.version}</Text>
          </View>
        ) : (
          <StatusView
            state={detailView}
            subject="la incidencia"
            onRetry={() => lastSelection.current && handleSelect(lastSelection.current)}
            onCancel={() => dispatchDetail({ type: 'cancel' })}
          />
        )}
        <StateButton label="Regresar a la lista de incidencias" text="Regresar a la lista" onPress={() => dispatchDetail({ type: 'clear' })} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header} accessibilityRole="header">
        Incidencias visibles para {identity.role}
      </Text>
      {message ? (
        <Text testID="incident-message" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {listView.kind === 'success' ? (
        <FlatList
          data={listView.value}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              accessibilityRole="button"
              accessibilityLabel={`Abrir incidencia ${item.id}, estado ${item.status}`}
              onPress={() => handleSelect(item.id)}
            >
              <Text style={styles.itemTitle}>
                {item.id} · {item.category}
              </Text>
              <Text>Estado: {item.status}</Text>
            </TouchableOpacity>
          )}
        />
      ) : (
        <StatusView state={listView} subject="incidencias" onRetry={loadList} onCancel={() => dispatchList({ type: 'cancel' })} />
      )}
      {identity.role === 'reporter' ? (
        <CreateIncidentForm
          role={identity.role}
          useCase={createIncidentUseCase}
          resolveLocation={resolveLocationUseCase}
          onCreated={loadList}
          onError={handleError}
        />
      ) : null}
    </View>
  );
}

const LOCATION_NOTICES: Readonly<Record<LocationNotice, string>> = {
  provider: 'Ubicación encontrada por el servicio de mapas.',
  provider_unavailable:
    'El servicio de ubicación no está disponible. Se guardará lo que escribiste (edificio, zona o referencia).',
  provider_invalid:
    'El servicio no devolvió una ubicación válida. Se guardará lo que escribiste (edificio, zona o referencia).',
};

function CreateIncidentForm({
  role,
  useCase,
  resolveLocation,
  onCreated,
  onError,
}: Readonly<{
  role: CampusRole;
  useCase: CreateIncidentUseCase;
  resolveLocation?: ResolveIncidentLocationUseCase | undefined;
  onCreated: () => void;
  onError: (error: ApiError) => void;
}>) {
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // The same key is reused while the draft does not change, so a retry after a timeout does not duplicate.
  const draftKey = useRef(createIdempotencyKey());

  // The typed text is never lost: on failure it stays as the manual location, without coordinates.
  const searchLocation = async () => {
    if (!resolveLocation || location.trim() === '') return;
    setSearching(true);
    const resolved = await resolveLocation.execute(location);
    setSearching(false);
    if (resolved.location.label !== location) {
      draftKey.current = createIdempotencyKey();
      setLocation(resolved.location.label);
    }
    setLocationNotice(LOCATION_NOTICES[resolved.notice]);
  };

  const submit = async () => {
    const result = await useCase.execute(role, { category: 'connectivity', description, location }, draftKey.current);
    if (result.ok) {
      draftKey.current = createIdempotencyKey();
      setDescription('');
      setLocation('');
      setLocationNotice(null);
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
        placeholder="Ubicación: edificio, zona o referencia"
        value={location}
        onChangeText={(text) => {
          draftKey.current = createIdempotencyKey();
          setLocationNotice(null);
          setLocation(text);
        }}
      />
      {resolveLocation ? (
        <TouchableOpacity
          style={styles.button}
          disabled={searching || location.trim() === ''}
          onPress={() => void searchLocation()}
        >
          <Text style={styles.buttonText}>{searching ? 'Buscando…' : 'Buscar ubicación'}</Text>
        </TouchableOpacity>
      ) : null}
      {locationNotice ? <Text testID="location-notice">{locationNotice}</Text> : null}
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
  status: { gap: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  button: { padding: 10, backgroundColor: '#007bff', borderRadius: 6 },
  buttonText: { color: '#fff', textAlign: 'center' },
});
