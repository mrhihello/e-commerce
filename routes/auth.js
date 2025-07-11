// auth.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const sellersPath = path.resolve(__dirname, '../models/sellers.json');
const customersPath = path.resolve(__dirname, '../models/customers.json');

async function readData(filePath, defaultValue = []) {
  try {
    await fs.access(filePath);
    const data = await fs.readFile(filePath, 'utf-8');
    return data.trim() ? JSON.parse(data) : defaultValue;
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeData(filePath, defaultValue);
      return defaultValue;
    }
    throw error;
  }
}

async function writeData(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ===== Seller Login =====
router.get('/seller/login', (req, res) => {
  res.render('seller/login', {
    error: null,
    success: null,
    warning: null,
    email: '',
    emailError: null,
    passwordError: null
  });
});

router.post('/seller/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const { email, password } = req.body;

    let emailError = null;
    let passwordError = null;

    if (!errors.isEmpty()) {
      errors.array().forEach(err => {
        if (err.param === 'email') emailError = err.msg;
        if (err.param === 'password') passwordError = err.msg;
      });

      return res.render('seller/login', {
        error: null,
        success: null,
        warning: null,
        email,
        emailError,
        passwordError
      });
    }

    try {
      const sellers = await readData(sellersPath);
      const seller = sellers.find(s => s.email === email.trim());

      if (!seller) {
        return res.render('seller/login', {
          error: 'Email not registered',
          success: null,
          warning: null,
          email,
          emailError: null,
          passwordError: null
        });
      }

      const match = await bcrypt.compare(password, seller.password);
      if (!match) {
        return res.render('seller/login', {
          error: 'Incorrect password',
          success: null,
          warning: null,
          email,
          emailError: null,
          passwordError: null
        });
      }

      if (!seller.approved) {
        return res.render('seller/login', {
          error: null,
          success: null,
          warning: 'Your account is not yet approved.',
          email,
          emailError: null,
          passwordError: null
        });
      }

      if (seller.blocked) {
        return res.render('seller/login', {
          error: null,
          success: null,
          warning: 'Your account is currently blocked.',
          email,
          emailError: null,
          passwordError: null
        });
      }

      req.session.seller = {
        id: seller.id,
        email: seller.email,
        name: seller.name
      };

      res.redirect('/seller/dashboard');
    } catch (err) {
      console.error('Login error:', err);
      res.render('seller/login', {
        error: 'An error occurred. Please try again.',
        success: null,
        warning: null,
        email,
        emailError: null,
        passwordError: null
      });
    }
  }
);

// Seller logout
router.get('/seller/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/seller/login'));
});

// ✅ CUSTOMER REGISTER
router.get('/customer/register', (req, res) => {
  res.render('customer/register', { error: null, success: null, formData: {} });
});

router.post('/customer/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  const errors = validationResult(req);
  const { name, phone, email, password } = req.body;
  if (!errors.isEmpty()) {
    return res.render('customer/register', {
      error: errors.array()[0].msg,
      success: null,
      formData: req.body
    });
  }

  const customers = await readData(customersPath);
  const exists = customers.find(c => c.email === email.trim().toLowerCase());
  if (exists) {
    return res.render('customer/register', {
      error: 'Email already registered',
      success: null,
      formData: req.body
    });
  }

  const newCustomer = {
    id: Date.now().toString(),
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim().toLowerCase(),
    password,
    createdAt: new Date().toISOString()
  };

  customers.push(newCustomer);
  await writeData(customersPath, customers);

  res.render('customer/login', { success: 'Account created. Please login.', error: null });
});

// ✅ CUSTOMER LOGIN
router.get('/customer/login', (req, res) => {
  res.render('customer/login', { error: null, success: req.query.success || null });
});

router.post('/customer/login', async (req, res) => {
  const { email, password } = req.body;

  const customers = await readData(customersPath);
  const found = customers.find(c => c.email === email.trim().toLowerCase() && c.password === password);

  if (!found) {
    return res.render('customer/login', { error: 'Invalid email or password', success: null });
  }

  // ✅ FIXED THIS ↓↓↓↓↓↓↓
  req.session.user = {
    id: found.id,
    name: found.name,
    email: found.email
  };

    res.redirect('/');  // ✅ Send to homepage (index.ejs)

});

// ✅ LOGOUT
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
