import { Router } from 'express';
import { pool } from '../config/db.js';

const accountsRouter = Router();

accountsRouter.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, user_id, currency, account_type
      FROM accounts
      ORDER BY currency, account_type
    `);

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

accountsRouter.get('/:id/balance', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      res.status(400).json({ error: 'ID de cuenta inválido' });
      return;
    }

    const result = await pool.query(
      `SELECT
         a.id,
         a.currency,
         COALESCE(
           SUM(
             CASE
               WHEN e.direction = 'credit' THEN e.amount
               WHEN e.direction = 'debit' THEN -e.amount
               ELSE 0
             END
           ), 0
         ) AS balance
       FROM accounts a
       LEFT JOIN entries e
         ON e.account_id = a.id
        AND e.currency = a.currency
       WHERE a.id = $1
       GROUP BY a.id, a.currency`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Cuenta no encontrada' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default accountsRouter;