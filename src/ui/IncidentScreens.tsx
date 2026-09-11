import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GetIncidentDetailUseCase, GetIncidentsUseCase } from '../application/incident-usecases';
import { Incident } from '../domain/incident';

interface Props {
  getIncidentsUseCase: GetIncidentsUseCase;
  getIncidentDetailUseCase: GetIncidentDetailUseCase;
}

export function IncidentListAndDetailScreen({
  getIncidentsUseCase,
  getIncidentDetailUseCase,
}: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  useEffect(() => {
    void getIncidentsUseCase.execute().then(setIncidents);
  }, [getIncidentsUseCase]);

  const handleSelect = (id: string) => {
    void getIncidentDetailUseCase.execute(id).then(setSelectedIncident);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>CampusOps — Incidencias</Text>
      {selectedIncident ? (
        <View style={styles.detailCard}>
          <Text style={styles.title}>Detalle: {selectedIncident.title}</Text>
          <Text>ID: {selectedIncident.id}</Text>
          <Text>Estado: {selectedIncident.status}</Text>
          <Text>Ubicación: {selectedIncident.location}</Text>
          <Text>Descripción: {selectedIncident.description}</Text>
          <TouchableOpacity style={styles.button} onPress={() => setSelectedIncident(null)}>
            <Text style={styles.buttonText}>Regresar a la lista</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={incidents}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => handleSelect(item.id)}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text>
                Estado: {item.status} | {item.location}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f8f9fa' },
  header: { fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  card: { padding: 14, backgroundColor: '#fff', borderRadius: 8, marginBottom: 8 },
  detailCard: { padding: 16, backgroundColor: '#fff', borderRadius: 8 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  button: { marginTop: 16, padding: 10, backgroundColor: '#007bff', borderRadius: 6 },
  buttonText: { color: '#fff', textAlign: 'center' },
});
