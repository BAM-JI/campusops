import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { CreateIncidentUseCase, GetIncidentDetailUseCase, GetIncidentsUseCase } from '../../src/application/incident-usecases';
import { ResolveIncidentLocationUseCase } from '../../src/application/location-usecases';
import type { IIncidentRepository, NewIncident } from '../../src/domain/incident';
import { failure, success } from '../../src/domain/result';
import type { GeocodingPort } from '../../src/location/geocoding-adapter';
import { IncidentListAndDetailScreen } from '../../src/ui/IncidentScreens';

// Compiling the React Native components on a cold cache (clean clone) can exceed the 5 s default.
jest.setTimeout(60000);

function screenWith(geocoder: GeocodingPort) {
  const created: NewIncident[] = [];
  const repository: IIncidentRepository = {
    getAll: async () => success([]),
    getById: async () => failure({ kind: 'not_found' }),
    create: async (input) => {
      created.push(input);
      const incident = {
        id: 'campus-inc-900',
        version: 1,
        status: 'open' as const,
        ...input,
        reporterId: 'reporter-1',
        assignedTechnicianId: null,
        priority: 'medium' as const,
      };
      return success({ incident, operationId: 'op-form-0001', duplicate: false });
    },
    act: async () => failure({ kind: 'forbidden' }),
  };
  const view = render(
    <IncidentListAndDetailScreen
      identity={{ actorId: 'reporter-1', role: 'reporter' }}
      getIncidentsUseCase={new GetIncidentsUseCase(repository)}
      getIncidentDetailUseCase={new GetIncidentDetailUseCase(repository)}
      createIncidentUseCase={new CreateIncidentUseCase(repository)}
      resolveLocationUseCase={new ResolveIncidentLocationUseCase(geocoder)}
      onUnauthorized={() => undefined}
    />,
  );
  return { view, created };
}

test('the form keeps the typed building when the provider is down and warns the user', async () => {
  const { view, created } = screenWith({ geocode: async () => ({ kind: 'unavailable', reason: 'timeout' }) });
  const screen = await view;

  await fireEvent.changeText(screen.getByPlaceholderText('Descripción'), 'Sin red en el aula');
  await fireEvent.changeText(screen.getByPlaceholderText('Ubicación: edificio, zona o referencia'), 'Edificio de prueba A, planta 2');
  await fireEvent.press(screen.getByText('Buscar ubicación'));

  await waitFor(() => expect(screen.getByTestId('location-notice').props.children).toContain('no está disponible'));
  expect(screen.getByDisplayValue('Edificio de prueba A, planta 2')).toBeTruthy();

  await fireEvent.press(screen.getByText('Enviar'));
  await waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]).toEqual({ category: 'connectivity', description: 'Sin red en el aula', location: 'Edificio de prueba A, planta 2' });
});

test('the form uses the provider label when the location is valid', async () => {
  const { view } = screenWith({
    geocode: async () => ({ kind: 'result', data: { label: 'Laboratorio ficticio', latitude: 10, longitude: 20 } }),
  });
  const screen = await view;
  await fireEvent.changeText(screen.getByPlaceholderText('Ubicación: edificio, zona o referencia'), 'laboratorio');
  await fireEvent.press(screen.getByText('Buscar ubicación'));
  await waitFor(() => expect(screen.getByDisplayValue('Laboratorio ficticio')).toBeTruthy());
  expect(screen.getByTestId('location-notice').props.children).toContain('servicio de mapas');
});
