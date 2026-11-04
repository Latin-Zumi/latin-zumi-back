import 'dotenv/config';

const baseUrl = process.env.BACKEND_URL?.replace(/\/+$/, '');
const secret = process.env.INTERNAL_CRON_SECRET;

if (!baseUrl || !secret) {
  console.error('Faltan BACKEND_URL o INTERNAL_CRON_SECRET.');
  process.exit(1);
}

if (process.env.INTEREST_RUN_CONFIRM !== 'yes') {
  console.error('Ejecución cancelada. Definí INTEREST_RUN_CONFIRM=yes para confirmar.');
  process.exit(1);
}

const response = await fetch(`${baseUrl}/internal/accrue-interest`, {
  method: 'POST',
  headers: { 'X-Internal-Secret': secret },
});

const body = await response.text();
console.log(`HTTP ${response.status}`);
console.log(body);

if (!response.ok) {
  process.exitCode = 1;
}
