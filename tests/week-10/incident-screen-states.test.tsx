import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { CreateIncidentUseCase, GetIncidentDetailUseCase, GetIncidentsUseCase } from '../../src/application/incident-usecases';
import type { IIncidentRepository, Incident } from '../../src/domain/incident';
import { failure, success, type ApiResult } from '../../src/domain/result';
import { IncidentListAndDetailScreen } from '../../src/ui/IncidentScreens';

// Compiling the React Native components on a cold cache (clean clone) can exceed the 5 s default.
jest.setTimeout(60000);

const incident = (id: string): Incident => ({
  id,
  version: 1,
  status: 'assigned',
  category: 'connectivity',
  description: `Falla ficticia ${id}`,
  location: 'Edificio de prueba A',
  reporterId: 'reporter-1',
  assignedTechnicianId: 'technician-1',
  priority: 'medium',
});

/** A promise the test resolves when it wants, to control the arrival order of answers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function repositoryWith(handlers: Readonly<{
  getAll?: () => Promise<ApiResult<readonly Incident[]>>;
  getById?: (id: string) => Promise<ApiResult<Incident>>;
}>): IIncidentRepository {
  return {
    getAll: handlers.getAll ?? (async () => success([incident('campus-inc-001'), incident('campus-inc-002')])),
    getById: handlers.getById ?? (async (id) => success(incident(id))),
    create: async () => failure({ kind: 'forbidden' }),
    act: async () => failure({ kind: 'forbidden' }),
  };
}

async function show(repository: IIncidentRepository, onUnauthorized: () => void = () => undefined) {
  return render(
    <IncidentListAndDetailScreen
      identity={{ actorId: 'technician-1', role: 'technician' }}
      getIncidentsUseCase={new GetIncidentsUseCase(repository)}
      getIncidentDetailUseCase={new GetIncidentDetailUseCase(repository)}
      createIncidentUseCase={new CreateIncidentUseCase(repository)}
      onUnauthorized={onUnauthorized}
    />,
  );
}

test('loading ends in success with accessible list items', async () => {
  // The answer is held until the loading state was observed, so the check does not depend on timing.
  const answer = deferred<ApiResult<readonly Incident[]>>();
  const screen = await show(repositoryWith({ getAll: () => answer.promise }));
  await waitFor(() => expect(screen.getByLabelText('Cargando incidencias')).toBeTruthy());
  await act(async () => {
    answer.resolve(success([incident('campus-inc-001'), incident('campus-inc-002')]));
  });
  await waitFor(() => expect(screen.getByLabelText('Abrir incidencia campus-inc-001, estado assigned')).toBeTruthy());
  expect(screen.queryByLabelText('Cargando incidencias')).toBeNull();
});

test('an empty list shows the empty state with a way to refresh', async () => {
  const screen = await show(repositoryWith({ getAll: async () => success([]) }));
  await waitFor(() => expect(screen.getByText('No hay incidencias visibles para tu perfil.')).toBeTruthy());
  expect(screen.getByLabelText('Actualizar incidencias')).toBeTruthy();
});

test('a server error can be retried and recovers', async () => {
  let fail = true;
  const screen = await show(
    repositoryWith({
      getAll: async () => {
        if (fail) {
          fail = false;
          return failure({ kind: 'server', status: 500 });
        }
        return success([incident('campus-inc-001')]);
      },
    }),
  );
  await waitFor(() => expect(screen.getByText('El servidor tuvo un error interno.')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Reintentar cargar incidencias'));
  await waitFor(() => expect(screen.getByLabelText('Abrir incidencia campus-inc-001, estado assigned')).toBeTruthy());
});

test('without connection the screen says so instead of waiting forever', async () => {
  const screen = await show(repositoryWith({ getAll: async () => failure({ kind: 'network' }) }));
  await waitFor(() => expect(screen.getByText('Sin conexión con el servidor. Revisa tu red y vuelve a intentar.')).toBeTruthy());
  expect(screen.queryByLabelText('Cargando incidencias')).toBeNull();
  expect(screen.getByLabelText('Reintentar cargar incidencias')).toBeTruthy();
});

test('the user can cancel a slow load and the late answer is not shown', async () => {
  const slow = deferred<ApiResult<readonly Incident[]>>();
  const screen = await show(repositoryWith({ getAll: () => slow.promise }));
  await waitFor(() => expect(screen.getByLabelText('Cancelar carga de incidencias')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Cancelar carga de incidencias'));
  expect(screen.getByText('Carga cancelada.')).toBeTruthy();
  slow.resolve(success([incident('campus-inc-001')]));
  await waitFor(() => expect(screen.getByLabelText('Volver a cargar incidencias')).toBeTruthy());
  expect(screen.queryByLabelText('Abrir incidencia campus-inc-001, estado assigned')).toBeNull();
});

test('a late answer of the previous selection does not replace the active incident', async () => {
  const answers = new Map([
    ['campus-inc-001', deferred<ApiResult<Incident>>()],
    ['campus-inc-002', deferred<ApiResult<Incident>>()],
  ]);
  const screen = await show(repositoryWith({ getById: (id) => answers.get(id)!.promise }));
  await waitFor(() => expect(screen.getByLabelText('Abrir incidencia campus-inc-001, estado assigned')).toBeTruthy());

  await fireEvent.press(screen.getByLabelText('Abrir incidencia campus-inc-001, estado assigned'));
  expect(screen.getByLabelText('Cargando la incidencia')).toBeTruthy();
  // The user goes back and opens another incident before the first answer arrives.
  await fireEvent.press(screen.getByLabelText('Regresar a la lista de incidencias'));
  await waitFor(() => expect(screen.getByLabelText('Abrir incidencia campus-inc-002, estado assigned')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Abrir incidencia campus-inc-002, estado assigned'));

  answers.get('campus-inc-002')!.resolve(success(incident('campus-inc-002')));
  await waitFor(() => expect(screen.getByTestId('detail-title').props.children.join('')).toBe('Incidencia campus-inc-002'));
  await act(async () => {
    answers.get('campus-inc-001')!.resolve(success(incident('campus-inc-001')));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.getByTestId('detail-title').props.children.join('')).toBe('Incidencia campus-inc-002');
});

test('a detail error offers retry and back, and an expired session returns to login', async () => {
  const onUnauthorized = jest.fn();
  let attempts = 0;
  const screen = await show(
    repositoryWith({
      getById: async (id) => {
        attempts += 1;
        return attempts === 1 ? failure({ kind: 'unauthorized' }) : success(incident(id));
      },
    }),
    onUnauthorized,
  );
  await waitFor(() => expect(screen.getByLabelText('Abrir incidencia campus-inc-001, estado assigned')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Abrir incidencia campus-inc-001, estado assigned'));
  await waitFor(() => expect(screen.getByText('La sesión expiró. Inicia sesión de nuevo.')).toBeTruthy());
  expect(onUnauthorized).toHaveBeenCalled();
  expect(screen.getByLabelText('Regresar a la lista de incidencias')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Reintentar cargar la incidencia'));
  await waitFor(() => expect(screen.getByTestId('detail-title')).toBeTruthy());
});
