const express = require('express');
const { authenticate, authorize, uuidv7 } = require('./middleware');

const router = express.Router();

module.exports = function(pool) {

    // GET /admin/users — list all users (admin only)
    router.get('/users', authenticate, authorize('admin'), async (req, res) => {
        try {
            const { page = '1', limit = '10' } = req.query;
            const pageNum = parseInt(page) || 1;
            const limitNum = Math.min(parseInt(limit) || 10, 50);
            const offset = (pageNum - 1) * limitNum;
            const countRes = await pool.query('SELECT COUNT(*) FROM users');
            const total = parseInt(countRes.rows[0].count);
            const result = await pool.query(
                'SELECT id, github_id, username, email, avatar_url, role, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
                [limitNum, offset]
            );
            const total_pages = Math.ceil(total / limitNum) || 1;
            res.json({
                status: 'success', data: result.rows,
                pagination: { page: pageNum, limit: limitNum, total, total_pages, has_next: pageNum < total_pages, has_prev: pageNum > 1 }
            });
        } catch (error) {
            console.error('GET /admin/users error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // PATCH /admin/users/:id/role — change user role (admin only)
    router.patch('/users/:id/role', authenticate, authorize('admin'), async (req, res) => {
        try {
            const { role } = req.body;
            if (!role || !['admin', 'analyst'].includes(role)) {
                return res.status(422).json({ status: 'error', message: 'Invalid role. Must be admin or analyst' });
            }
            const result = await pool.query(
                'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, github_id, username, email, avatar_url, role, created_at',
                [role, req.params.id]
            );
            if (result.rows.length === 0) return res.status(404).json({ status: 'error', message: 'User not found' });
            res.json({ status: 'success', data: result.rows[0] });
        } catch (error) {
            console.error('PATCH /admin/users/:id/role error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    // GET /admin/logs — view request logs (admin only)
    router.get('/logs', authenticate, authorize('admin'), async (req, res) => {
        try {
            const { page = '1', limit = '20', method, path } = req.query;
            const pageNum = parseInt(page) || 1;
            const limitNum = Math.min(parseInt(limit) || 20, 100);
            const offset = (pageNum - 1) * limitNum;
            let conditions = 'WHERE 1=1';
            const params = [];
            let idx = 1;
            if (method) { conditions += ` AND method = $${idx++}`; params.push(method.toUpperCase()); }
            if (path) { conditions += ` AND path LIKE $${idx++}`; params.push(`%${path}%`); }
            const countRes = await pool.query(`SELECT COUNT(*) FROM request_logs ${conditions}`, params);
            const total = parseInt(countRes.rows[0].count);
            const result = await pool.query(
                `SELECT * FROM request_logs ${conditions} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
                [...params, limitNum, offset]
            );
            const total_pages = Math.ceil(total / limitNum) || 1;
            res.json({
                status: 'success', data: result.rows,
                pagination: { page: pageNum, limit: limitNum, total, total_pages, has_next: pageNum < total_pages, has_prev: pageNum > 1 }
            });
        } catch (error) {
            console.error('GET /admin/logs error:', error.message);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    });

    return router;
};
