const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// Normalize phone number format
function normalizePhoneNumber(phone) {
  if (!phone) return phone;
  
  // Remove spaces and special characters except digits
  let normalized = phone.replace(/\D/g, '');
  
  // If starts with 0, replace with 254
  if (normalized.startsWith('0')) {
    normalized = '254' + normalized.substring(1);
  }
  // If doesn't start with 254, add it
  else if (!normalized.startsWith('254')) {
    normalized = '254' + normalized;
  }
  
  return normalized;
}

// Borrower creates loan request
router.post('/request', verifyToken, async (req, res) => {
  try {
    const {
      lender_phone,
      principal_amount,
      repayment_method,
      repayment_amount,
      repayment_start_date
    } = req.body;
    
    // Validate input
    if (!lender_phone || !principal_amount || !repayment_method || !repayment_amount || !repayment_start_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Normalize phone number (remove +, leading 0)
    const normalizedPhone = normalizePhoneNumber(lender_phone);
    
    // Get lender by phone
    const lender = await pool.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [normalizedPhone]
    );
    
    if (lender.rows.length === 0) {
      return res.status(404).json({ error: 'Lender not found' });
    }
    
    // Create loan
    const loan = await pool.query(
      `INSERT INTO loans (id, borrower_id, lender_id, principal_amount, remaining_balance, repayment_method, repayment_amount, repayment_start_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, borrower_id, lender_id, principal_amount, remaining_balance, repayment_method, repayment_amount, repayment_start_date, status, created_at`,
      [uuidv4(), req.user.id, lender.rows[0].id, principal_amount, principal_amount, repayment_method, repayment_amount, repayment_start_date, 'pending']
    );
    
    // Create notification for lender
    await pool.query(
      `INSERT INTO notifications (id, user_id, loan_id, notification_type, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), lender.rows[0].id, loan.rows[0].id, 'loan_request', `New loan request: Ksh ${principal_amount} from borrower`]
    );
    
    res.status(201).json({
      message: 'Loan request created successfully',
      loan: loan.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Lender approves/declines loan
router.patch('/:loanId/approval', verifyToken, async (req, res) => {
  try {
    const { loanId } = req.params;
    const { approved } = req.body;
    
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'Invalid approval status' });
    }
    
    const loan = await pool.query(
      'SELECT borrower_id, lender_id FROM loans WHERE id = $1',
      [loanId]
    );
    
    if (loan.rows.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    
    if (loan.rows[0].lender_id !== req.user.id) {
      return res.status(403).json({ error: 'Only lender can approve/decline' });
    }
    
    const newStatus = approved ? 'active' : 'declined';
    const updatedLoan = await pool.query(
      `UPDATE loans SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [newStatus, loanId]
    );
    
    // Notify borrower
    await pool.query(
      `INSERT INTO notifications (id, user_id, loan_id, notification_type, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), loan.rows[0].borrower_id, loanId, 'approval', `Loan ${newStatus}`]
    );
    
    res.json({
      message: `Loan ${newStatus} successfully`,
      loan: updatedLoan.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get borrower's loans
router.get('/borrower', verifyToken, async (req, res) => {
  try {
    const loans = await pool.query(
      `SELECT l.*, u.full_name as lender_name, u.phone_number as lender_phone
       FROM loans l
       JOIN users u ON l.lender_id = u.id
       WHERE l.borrower_id = $1
       ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    
    res.json(loans.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get lender's loans
router.get('/lender', verifyToken, async (req, res) => {
  try {
    const loans = await pool.query(
      `SELECT l.*, u.full_name as borrower_name, u.phone_number as borrower_phone
       FROM loans l
       JOIN users u ON l.borrower_id = u.id
       WHERE l.lender_id = $1
       ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    
    res.json(loans.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
