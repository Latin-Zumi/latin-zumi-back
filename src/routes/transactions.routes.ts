import { Router } from 'express';
import { pool } from '../config/db.js';

const transactionsRouter = Router();

transactionsRouter.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, idempotency_key, description, occurred_at
      FROM transactions
      ORDER BY occurred_at DESC
      LIMIT 100
    `);

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

transactionsRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      res.status(400).json({ error: 'ID de transacción inválido' });
      return;
    }

    const transaction = await pool.query(
      `SELECT id, idempotency_key, description, occurred_at
       FROM transactions
       WHERE id = $1`,
      [id],
    );

    if (transaction.rows.length === 0) {
      res.status(404).json({ error: 'Transacción no encontrada' });
      return;
    }

    const entries = await pool.query(
      `SELECT account_id, amount, direction, currency
       FROM entries
       WHERE transaction_id = $1`,
      [id],
    );

    res.json({
      data: {
        ...transaction.rows[0],
        entries: entries.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default transactionsRouter;