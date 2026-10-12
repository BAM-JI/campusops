// test-sesion-semana6.ts
let refreshCount = 0;
let isRefreshing = false;

// Configuración de simulación
let simulatedRefreshTokenValid = true; // Cambiar a false para Caso B

async function simulateRefresh(): Promise<string> {
  refreshCount++;
  console.log(`[AUTH] REFRESH START (Intento #${refreshCount})`);
  await new Promise((r) => setTimeout(r, 100)); // Latencia de red
  
  if (!simulatedRefreshTokenValid) {
    console.log('[AUTH] REFRESH FAILED (401 / Invalid Refresh Token)');
    throw new Error('Refresh token expired');
  }

  console.log('[AUTH] REFRESH SUCCESS');
  return 'new-access-token-xyz';
}

async function apiRequest(id: string, endpoint: string): Promise<string> {
  console.log(`[${id}] REQUEST -> ${endpoint}`);
  // Simular expiración de accessToken
  console.log(`[${id}] 401 Unauthorized`);

  // Comportamiento sin cola sincronizada (cada petición reacciona por sí misma)
  try {
    const newToken = await simulateRefresh();
    console.log(`[${id}] RETRY con ${newToken}`);
    console.log(`[${id}] 200 SUCCESS`);
    return `${id} OK`;
  } catch (err) {
    console.log(`[${id}] ERROR: Sesión terminada`);
    throw err;
  }
}

async function runTest(caseName: string) {
  console.log(`\n=== INICIANDO ${caseName} ===`);
  refreshCount = 0;
  
  const results = await Promise.allSettled([
    apiRequest('A', '/v1/incidents/campus-inc-001'),
    apiRequest('B', '/v1/incidents'),
    apiRequest('C', '/v1/geocoding?q=laboratorio')
  ]);
  
  console.log(`=== FIN ${caseName} | Total Refresh: ${refreshCount} ===\n`);
}

// Ejecutar
const isCaseB = process.env.CASE_B === 'true';
if (isCaseB) {
  simulatedRefreshTokenValid = false;
  runTest('CASO B (Refresh Falla)');
} else {
  simulatedRefreshTokenValid = true;
  runTest('CASO A (Refresh Exitoso)');
}